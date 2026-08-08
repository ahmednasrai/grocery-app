-- ==== Rushdy Mart - Migration 009: Fractional & Sub-Unit Quantities ====
-- Run in the Supabase SQL Editor (supabase.com/dashboard -> SQL Editor -> Run).
-- IDEMPOTENT: safe to run repeatedly.
--
-- Adds full support for fractional / partial quantities:
--   * kg products can be sold in GRAMS ('g'):       1 kg  = 1000 g
--   * liter products can be sold in MILLILITERS ('ml'): 1 L = 1000 ml
--   * decimal quantities in base units are allowed (0.25 kg / 1.5 liter)
--   * piece / carton quantities must stay WHOLE numbers (rejected otherwise)
--
-- g/ml are COMMERCIAL sub-units, NOT physical density conversions.
-- No stock values are rewritten: existing base units keep their numbers.
--
-- What this changes:
--   1. products.stock / products.stock_qty      integer     -> numeric(12,4)
--   2. sale_items.quantity / sale_items.base_qty integer     -> numeric(12,4)
--      (return_items.quantity/base_qty are already numeric since 008)
--   3. _to_base_quantity now converts g -> kg and ml -> liter (divide by 1000).
--      receive_stock / adjust_stock / create_return use the same helper, so
--      receiving and returning in grams/ml works automatically.
--   4. create_sale rewritten to use _to_base_quantity everywhere and to price
--      fractional units correctly:
--        price per gram   = base price / 1000
--        price per ml     = base price / 1000
--        subtotal         = base qty x base price   (round 2)
--        unit_price       = subtotal / selling qty  (round 4)
--      Oversell guard, row locks, single transaction and idempotency are
--      preserved exactly (same semantics as migration 004 v2).
--
-- Scale 4 = half a gram at kg scale (0.0001 kg); every quantity path in the
-- system rounds to 4 decimals max, so numeric(12,4) is exact for all of them.

-- -------------------------------------------------------------------------
-- 1. Widen stock columns to numeric (base units may now be fractional)
-- -------------------------------------------------------------------------
alter table public.products
  alter column stock type numeric(12,4) using stock::numeric(12,4);

alter table public.products
  alter column stock_qty type numeric(12,4) using stock_qty::numeric(12,4);

-- -------------------------------------------------------------------------
-- 2. Widen sale ledger columns (quantity = sold in selling unit,
--    base_qty = equivalent base units, may be fractional)
-- -------------------------------------------------------------------------
alter table public.sale_items
  alter column quantity type numeric(12,4) using quantity::numeric(12,4);

alter table public.sale_items
  alter column base_qty type numeric(12,4) using base_qty::numeric(12,4);

-- -------------------------------------------------------------------------
-- 3. Shared unit -> base conversion (g/ml sub-units)
-- -------------------------------------------------------------------------
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
  if p_sell_type = 'piece' then
    if p_unit is not null and p_unit <> p_sell_type then
      raise exception 'invalid_unit:%', p_unit;
    end if;
    v_base := p_qty;
  elsif p_sell_type = 'kg' then
    if p_unit is null or p_unit = 'kg' then
      v_base := p_qty;
    elsif p_unit = 'g' then
      v_base := p_qty / 1000;
    else
      raise exception 'invalid_unit:%', p_unit;
    end if;
  elsif p_sell_type = 'liter' then
    if p_unit is null or p_unit = 'liter' then
      v_base := p_qty;
    elsif p_unit = 'ml' then
      v_base := p_qty / 1000;
    else
      raise exception 'invalid_unit:%', p_unit;
    end if;
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

-- -------------------------------------------------------------------------
-- 4. Atomic create_sale (same lock/idempotency/oversell semantics)
-- -------------------------------------------------------------------------
create or replace function public.create_sale(
  p_employee_name text,
  p_items jsonb,
  p_client_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id bigint;
  v_total numeric := 0;
  v_line jsonb;
  v_pid bigint;
  v_qty numeric;
  v_unit text;
  v_rule text;
  v_upc numeric;
  v_kgs numeric;
  v_base_price numeric;
  v_capacity numeric;
  v_base_qty numeric;
  v_price_per_unit numeric;
  v_stock_qty numeric;
  v_existing jsonb;
begin
  -- Idempotency: replay returns the stored sale
  if p_client_request_id is not null then
    select jsonb_build_object('id', s.id, 'employee_name', s.employee_name,
                              'total_amount', s.total_amount, 'client_request_id', s.client_request_id)
      into v_existing
      from public.sales s
     where s.client_request_id = p_client_request_id;
    if v_existing is not null then
      return jsonb_build_object('idempotent', true,
                                'id', (v_existing->>'id')::bigint,
                                'employee_name', v_existing->>'employee_name',
                                'total_amount', (v_existing->>'total_amount')::numeric,
                                'client_request_id', p_client_request_id);
    end if;
  end if;

  -- Phase 1: resolve + lock every product row, validate selling unit, check stock
  for v_line in select * from jsonb_array_elements(p_items)
  loop
    v_pid  := (v_line->>'product_id')::bigint;
    v_qty  := (v_line->>'quantity')::numeric;
    v_unit := (v_line->>'selling_unit')::text;

    if v_pid is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_quantity' using errcode = 'P0001';
    end if;

    select sell_type, units_per_carton, kg_per_sack, price, coalesce(stock_qty, stock, 0)
      into v_rule, v_upc, v_kgs, v_base_price, v_stock_qty
      from public.products p
     where p.id = v_pid
     for update;

    if v_rule is null then
      raise exception 'product_not_found:%', v_pid using errcode = 'P0001';
    end if;

    -- Default the selling unit to the product's base unit when omitted
    if v_unit is null then
      v_unit := v_rule;
    end if;

    v_capacity := 1;
    if v_rule = 'carton' then
      if v_unit = 'carton' then
        v_capacity := coalesce(v_upc, 0);
        if v_capacity <= 0 then
          raise exception 'invalid_capacity:%', v_pid using errcode = 'P0001';
        end if;
      elsif v_unit <> 'piece' then
        raise exception 'invalid_unit:%:%', v_pid, v_unit using errcode = 'P0001';
      end if;
    elsif v_rule = 'sack' then
      if v_unit = 'sack' then
        v_capacity := coalesce(v_kgs, 0);
        if v_capacity <= 0 then
          raise exception 'invalid_capacity:%', v_pid using errcode = 'P0001';
        end if;
      elsif v_unit <> 'kg' then
        raise exception 'invalid_unit:%:%', v_pid, v_unit using errcode = 'P0001';
      end if;
    elsif v_rule = 'kg' then
      if v_unit = 'g' then
        v_capacity := 0.001; -- commercial sub-unit: 1 kg = 1000 g
      elsif v_unit <> 'kg' then
        raise exception 'invalid_unit:%:%', v_pid, v_unit using errcode = 'P0001';
      end if;
    elsif v_rule = 'liter' then
      if v_unit = 'ml' then
        v_capacity := 0.001; -- commercial sub-unit: 1 L = 1000 ml
      elsif v_unit <> 'liter' then
        raise exception 'invalid_unit:%:%', v_pid, v_unit using errcode = 'P0001';
      end if;
    else
      if v_unit <> v_rule then
        raise exception 'invalid_unit:%:%', v_pid, v_unit using errcode = 'P0001';
      end if;
    end if;

    -- Whole quantities only for piece / carton (no fractional pieces/boxes)
    if v_rule in ('piece', 'carton') and v_qty <> floor(v_qty) then
      raise exception 'invalid_quantity' using errcode = 'P0001';
    end if;

    v_base_qty       := round(v_qty * v_capacity, 4);
    v_price_per_unit := round(coalesce(v_base_price, 0) * v_capacity, 4);

    if v_stock_qty < v_base_qty then
      raise exception 'insufficient_stock:%:%', v_pid, v_stock_qty using errcode = 'P0001';
    end if;

    v_total := v_total + round(v_qty * v_price_per_unit, 2);
  end loop;

  -- Phase 2: invoice
  insert into public.sales (employee_name, total_amount, client_request_id)
  values (p_employee_name, v_total, p_client_request_id)
  returning id into v_sale_id;

  -- Phase 3: ledger lines + stock deduction (same transaction)
  for v_line in select * from jsonb_array_elements(p_items)
  loop
    v_pid  := (v_line->>'product_id')::bigint;
    v_qty  := (v_line->>'quantity')::numeric;
    v_unit := (v_line->>'selling_unit')::text;

    select sell_type, units_per_carton, kg_per_sack, price
      into v_rule, v_upc, v_kgs, v_base_price
      from public.products where id = v_pid;

    if v_unit is null then
      v_unit := v_rule;
    end if;

    -- Same unit -> base conversion as Phase 1 (single source of truth);
    -- rounded to 4 decimals so the check, the deduction and the ledger row
    -- are EXACTLY the same number even for deep-precision inputs.
    v_base_qty       := round(public._to_base_quantity(v_rule, v_unit, v_qty, v_upc, v_kgs), 4);
    v_price_per_unit := round(coalesce(v_base_price, 0) * v_base_qty / v_qty, 4);

    insert into public.sale_items (sale_id, product_id, quantity, unit_price,
                                   subtotal, selling_unit, base_qty)
    values (v_sale_id, v_pid, v_qty, v_price_per_unit,
            round(v_base_qty * coalesce(v_base_price, 0), 2), v_unit, v_base_qty);

    update public.products
       set stock     = stock     - v_base_qty,
           stock_qty = stock_qty - v_base_qty
     where id = v_pid;
  end loop;

  return jsonb_build_object('id', v_sale_id,
                            'employee_name', p_employee_name,
                            'total_amount', v_total,
                            'client_request_id', p_client_request_id);
end;
$$;

-- Grants: only the backend service role may execute (same as before)
revoke all on function public._to_base_quantity(text, text, numeric, numeric, numeric) from public;
grant execute on function public._to_base_quantity(text, text, numeric, numeric, numeric) to service_role;

revoke all on function public.create_sale(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_sale(text, jsonb, text) to service_role;

-- -------------------------------------------------------------------------
-- Sanity checks (run after applying):
--   select id, name, sell_type, stock, stock_qty from public.products order by id;
--   select pg_typeof(stock), pg_typeof(stock_qty) from public.products limit 1;
--   select pg_typeof(quantity), pg_typeof(base_qty) from public.sale_items limit 1;
-- Example: 250 g of a 40 EGP/kg product (stock 10 kg):
--   select create_sale('test', '[{"product_id":1,"quantity":250,"selling_unit":"g"}]');
--   -> total_amount 10.00, sale_items.base_qty 0.25, products.stock 9.75
-- -------------------------------------------------------------------------
