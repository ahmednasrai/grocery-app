-- ============================================================
-- Migration 005 - Minimum Stock + Stock Receiving / Adjustment
-- Rushdy Mart. IDEMPOTENT - safe to run repeatedly.
-- Run this in: Supabase Dashboard -> SQL Editor -> New query -> Run
--
-- v2 (2026-08-08): receive_stock + adjust_stock now take a row lock
-- (SELECT ... FOR UPDATE, same as create_sale) so concurrent sales and
-- stock ops never read stale stock (lost-update fix).
-- ============================================================

-- 1) minimum_stock column - stored in BASE units:
--    piece -> pieces | kg -> kg | liter -> liter | carton -> pieces | sack -> kg
alter table public.products add column if not exists minimum_stock numeric not null default 0;

create index if not exists idx_products_minimum_stock on public.products (minimum_stock);

-- 2) Shared unit -> base conversion helper (mirrors create_sale unit rules)
create or replace function public._to_base_quantity(
  p_sell_type text,
  p_unit text,
  p_qty numeric,
  p_units_per_carton numeric,
  p_kg_per_sack numeric
) returns numeric
language plpgsql immutable
as $$
declare
  v_base numeric;
begin
  if p_sell_type in ('piece', 'kg', 'liter') then
    if p_unit is not null and p_unit <> p_sell_type then
      raise exception 'invalid_unit:%', p_unit;
    end if;
    v_base := p_qty;
  elsif p_sell_type = 'carton' then
    if p_unit not in ('carton', 'piece') then
      raise exception 'invalid_unit:%', p_unit;
    end if;
    if p_unit = 'carton' then
      v_base := p_qty * coalesce(p_units_per_carton, 0);
    else
      v_base := p_qty;
    end if;
  elsif p_sell_type = 'sack' then
    if p_unit not in ('sack', 'kg') then
      raise exception 'invalid_unit:%', p_unit;
    end if;
    if p_unit = 'sack' then
      v_base := p_qty * coalesce(p_kg_per_sack, 0);
    else
      v_base := p_qty;
    end if;
  else
    raise exception 'invalid_unit:%', p_unit;
  end if;
  return v_base;
end;
$$;

-- 3) receive_stock - additive stock-in, unit aware, atomic
create or replace function public.receive_stock(
  p_product_id int,
  p_qty numeric,
  p_unit text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sell_type text;
  v_units_per_carton numeric;
  v_kg_per_sack numeric;
  v_product_id int;
  v_base numeric;
  v_row jsonb;
begin
  select id, sell_type, units_per_carton, kg_per_sack
    into v_product_id, v_sell_type, v_units_per_carton, v_kg_per_sack
    from public.products
   where id = p_product_id
   for update;
  if v_product_id is null then
    raise exception 'product_not_found:%', p_product_id;
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'invalid_quantity:%', p_qty;
  end if;
  if p_unit is null then
    p_unit := v_sell_type;
  end if;
  v_base := public._to_base_quantity(v_sell_type, p_unit, p_qty, v_units_per_carton, v_kg_per_sack);
  update public.products p
     set stock = coalesce(stock, 0) + v_base,
         stock_qty = coalesce(stock_qty, 0) + v_base,
         stock_in_base = true
   where id = p_product_id
   returning to_jsonb(p) into v_row;
  return v_row;
end;
$$;

-- 4) adjust_stock - operations: 'add' | 'subtract' | 'set'
--    add/subtract accept a selling unit (carton/sack/...); 'set' is absolute (base units)
create or replace function public.adjust_stock(
  p_product_id int,
  p_operation text,
  p_qty numeric,
  p_unit text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sell_type text;
  v_units_per_carton numeric;
  v_kg_per_sack numeric;
  v_product_id int;
  v_stock numeric;
  v_stock_qty numeric;
  v_base numeric;
  v_new numeric;
  v_row jsonb;
begin
  select id, sell_type, units_per_carton, kg_per_sack, stock, stock_qty
    into v_product_id, v_sell_type, v_units_per_carton, v_kg_per_sack, v_stock, v_stock_qty
    from public.products
   where id = p_product_id
   for update;
  if v_product_id is null then
    raise exception 'product_not_found:%', p_product_id;
  end if;
  if p_operation not in ('add', 'subtract', 'set') then
    raise exception 'invalid_operation:%', p_operation;
  end if;
  if p_qty is null or p_qty < 0 then
    raise exception 'invalid_quantity:%', p_qty;
  end if;

  if p_operation in ('add', 'subtract') then
    if p_unit is null then
      p_unit := v_sell_type;
    end if;
    v_base := _to_base_quantity(v_sell_type, p_unit, p_qty, v_units_per_carton, v_kg_per_sack);
  else
    v_base := p_qty;
  end if;

  if p_operation = 'add' then
    v_stock := coalesce(v_stock, 0) + v_base;
  elsif p_operation = 'subtract' then
    v_stock := coalesce(v_stock, 0) - v_base;
  else
    v_stock := v_base;
  end if;

  if v_stock < 0 then
    raise exception 'negative_stock_not_allowed:%:%', p_product_id, coalesce(v_stock, 0);
  end if;

  update public.products p
     set stock = v_stock,
         stock_qty = v_stock,
         stock_in_base = true
   where id = p_product_id
   returning to_jsonb(p) into v_row;
  return v_row;
end;
$$;

-- Grants: only service_role may execute (same as create_sale)
revoke all on function public._to_base_quantity(text, text, numeric, numeric, numeric) from public;
grant execute on function public._to_base_quantity(text, text, numeric, numeric, numeric) to service_role;

revoke all on function public.receive_stock(int, numeric, text) from public, anon, authenticated;
grant execute on function public.receive_stock(int, numeric, text) to service_role;

revoke all on function public.adjust_stock(int, text, numeric, text) from public, anon, authenticated;
grant execute on function public.adjust_stock(int, text, numeric, text) to service_role;

-- 6) backfill: carton products keep their current piece counts (no change), sacks unchanged.
--    New default minimum_stock = 0 means 'no alert' until the user sets a real threshold.

-- Done. Verify with:
--   select minimum_stock from products limit 1;
--   select receive_stock(1, 5, 'carton') ; -- example (adjust with your real product ids)