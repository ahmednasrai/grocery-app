-- ==== Rushdy Mart — Migration: Base-Unit Inventory + Partial-Sale RPC ====
-- Run in the Supabase SQL Editor (supabase.com/dashboard → SQL Editor → Run).
--
-- What this does:
--   1. Converts products.stock / products.stock_qty to the BASE sellable unit:
--        piece -> pieces | kg -> kg | liter -> liters
--        carton -> pieces inside all cartons (9 cartons x 24 pcs = 216)
--        sack   -> kg inside all sacks  (5 sacks x 25 kg = 125)
--      The conversion is guarded by a flag column, so re-running is a no-op
--      (the stock is never multiplied twice).
--   2. Adds selling_unit + base_qty to sale_items (nullable; old invoices stay
--      valid).
--   3. Replaces the create_sale RPC: it now receives per-line
--      (product_id, quantity, selling_unit), computes the deduction in base
--      units and the price from the stored base price, still 100% atomic:
--      SELECT FOR UPDATE + single transaction + oversell guard + idempotency.

-- ---------------------------------------------------------------------
-- 1. Base-unit stock conversion (idempotent via flag column)
-- ---------------------------------------------------------------------
alter table public.products
  add column if not exists stock_in_base boolean not null default false;

-- carton: stock = stock(boxes) * pieces-per-box
update public.products
   set stock         = round(stock * units_per_carton),
       stock_qty     = round(stock_qty * units_per_carton),
       stock_in_base = true
 where sell_type = 'carton'
   and stock_in_base = false
   and units_per_carton is not null
   and units_per_carton > 0;

-- sack: stock = stock(sacks) * kg-per-sack
update public.products
   set stock         = round(stock * kg_per_sack),
       stock_qty     = round(stock_qty * kg_per_sack),
       stock_in_base = true
 where sell_type = 'sack'
   and stock_in_base = false
   and kg_per_sack is not null
   and kg_per_sack > 0;

-- piece / kg / liter: already in base units, just mark
update public.products
   set stock_in_base = true
 where sell_type in ('piece', 'kg', 'liter')
   and stock_in_base = false;

-- ---------------------------------------------------------------------
-- 2. Sale item columns for selling-unit info (safe, additive)
-- ---------------------------------------------------------------------
alter table public.sale_items
  add column if not exists selling_unit text;

alter table public.sale_items
  add column if not exists base_qty integer default 0;

-- ---------------------------------------------------------------------
-- 3. Atomic create_sale RPC v2
-- ---------------------------------------------------------------------
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
    v_unit := coalesce((v_line->>'selling_unit')::text, 'piece');

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
    else
      if v_unit <> v_rule then
        raise exception 'invalid_unit:%:%', v_pid, v_unit using errcode = 'P0001';
      end if;
    end if;

    v_base_qty       := round(v_qty * v_capacity);
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
    v_unit := coalesce((v_line->>'selling_unit')::text, 'piece');

    select sell_type, units_per_carton, kg_per_sack, price
      into v_rule, v_upc, v_kgs, v_base_price
      from public.products where id = v_pid;

    v_capacity := 1;
    if v_rule = 'carton' and v_unit = 'carton' then
      v_capacity := coalesce(v_upc, 0);
    elsif v_rule = 'sack' and v_unit = 'sack' then
      v_capacity := coalesce(v_kgs, 0);
    end if;
    v_base_qty       := round(v_qty * v_capacity);
    v_price_per_unit := round(coalesce(v_base_price, 0) * v_capacity, 2);

    insert into public.sale_items (sale_id, product_id, quantity, unit_price,
                                   subtotal, selling_unit, base_qty)
    values (v_sale_id, v_pid, v_qty, v_price_per_unit,
            round(v_qty * v_price_per_unit, 2), v_unit, v_base_qty);

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

-- Only the backend service role may call this RPC.
revoke all on function public.create_sale(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_sale(text, jsonb, text) to service_role;

-- ---------------------------------------------------------------------
-- Sanity checks (run after applying):
--   select id, name, sell_type, units_per_carton, kg_per_sack,
--          stock, stock_qty, stock_in_base from public.products order by id;
-- ---------------------------------------------------------------------