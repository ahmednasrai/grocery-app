-- ==== Rushdy Mart - Migration 008 (v2): Returns & Stock Restoration ====
-- Run in the Supabase SQL Editor (supabase.com/dashboard -> SQL Editor -> Run).
-- IDEMPOTENT: safe to run repeatedly.
--
-- v2 changes vs v1:
--   * FINANCIAL returns: every return now computes its monetary value from the
--     ORIGINAL sale-time price (sale_items.unit_price / subtotal, never the
--     current product price). The value per returned unit = line subtotal *
--     (returned base qty / sold base qty), i.e. "returned qty x unit price at
--     sale time" even when the return unit differs (piece return of a carton
--     sale, kg return of a sack sale).
--   * sales.returned_amount (cumulative) + return_items.amount (per-line
--     snapshot) - both written inside the SAME atomic RPC transaction, while
--     sales.total_amount keeps its ORIGINAL value forever (history).
--   * AGGREGATION defense: if the caller duplicates sale_item_id inside the
--     same p_items array, quantities are aggregated BEFORE the exceeds check.
--
-- Net revenue everywhere = sales.total_amount - sales.returned_amount.
--
-- What this adds:
--   1. returns      - return header (sale, employee, reason, dedupe key)
--   2. return_items - returned lines: original sale_item_id, quantity, unit,
--                     base_qty equivalent + amount (financial snapshot)
--   3. sales.returned_amount - cumulative returned value per invoice
--   4. create_return RPC - ONE atomic transaction like create_sale:
--        - validates the original sale_item exists and belongs to the sale
--        - locks sale_items rows FOR UPDATE (no double-return under concurrency)
--        - locks product rows FOR UPDATE (co-operates with create_sale / stock ops)
--        - aggregates duplicates inside the request, then checks
--          remaining = sold_base_qty - already_returned (never below 0)
--        - restores stock = stock + base_qty, adds the financial amount to
--          sales.returned_amount, inserts header + lines - all or nothing
--   5. idempotency: client_request_id on returns (unique partial index)

-- -------------------------------------------------------------------------
-- 1. Returns header
-- -------------------------------------------------------------------------
create table if not exists public.returns (
  id bigint generated always as identity primary key,
  sale_id bigint not null references public.sales (id) on delete cascade,
  employee_name text not null,
  reason text,
  client_request_id text,
  created_at timestamptz not null default now()
);

create unique index if not exists returns_client_request_id_key
  on public.returns (client_request_id)
  where client_request_id is not null;

create index if not exists returns_sale_id_idx on public.returns (sale_id);

-- -------------------------------------------------------------------------
-- 2. Cumulative returned money on invoices (original total_amount untouched)
-- -------------------------------------------------------------------------
alter table public.sales
  add column if not exists returned_amount numeric not null default 0;

-- -------------------------------------------------------------------------
-- 3. Return lines: units + base + financial snapshot
-- -------------------------------------------------------------------------
create table if not exists public.return_items (
  id bigint generated always as identity primary key,
  return_id bigint not null references public.returns (id) on delete cascade,
  sale_item_id bigint not null references public.sale_items (id) on delete restrict,
  product_id bigint not null references public.products (id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  unit text not null,
  base_qty numeric not null check (base_qty > 0),
  amount numeric not null default 0
);

create index if not exists return_items_sale_item_id_idx on public.return_items (sale_item_id);
create index if not exists return_items_return_id_idx on public.return_items (return_id);

-- -------------------------------------------------------------------------
-- 4. Atomic create_return RPC v2 (mirrors create_sale)
-- -------------------------------------------------------------------------
create or replace function public.create_return(
  p_sale_id bigint,
  p_employee_name text,
  p_items jsonb,
  p_reason text default null,
  p_client_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id bigint;
  v_return_id bigint;
  v_line jsonb;
  v_item_id bigint;
  v_qty numeric;
  v_unit text;
  v_sale_base numeric;
  v_pid bigint;
  v_rule text;
  v_upc numeric;
  v_kgs numeric;
  v_sold_base numeric;
  v_sale_of_item bigint;
  v_unit_default text;
  v_subtotal_s numeric;
  v_unit_price numeric;
  v_qty_sold numeric;
  v_line_total_s numeric;
  v_amount numeric;
  v_amt_total numeric := 0;
  v_key text;
  v_agg_base numeric;
  v_returned_base numeric;
  v_existing jsonb;
  v_totals jsonb := '{}'::jsonb;
begin
  -- Idempotency: replay returns the stored return, never a second one
  if p_client_request_id is not null then
    select jsonb_build_object('id', r.id, 'sale_id', r.sale_id,
                              'client_request_id', r.client_request_id)
      into v_existing
      from public.returns r
     where r.client_request_id = p_client_request_id;
    if v_existing is not null then
      return jsonb_build_object('idempotent', true,
                                'id', (v_existing->>'id')::bigint,
                                'sale_id', (v_existing->>'sale_id')::bigint,
                                'client_request_id', p_client_request_id);
    end if;
  end if;

  -- Lock the sale row; serializes concurrent returns on the same invoice
  select id into v_sale_id
    from public.sales s
   where s.id = p_sale_id
   for update;
  if v_sale_id is null then
    raise exception 'sale_not_found:%', p_sale_id using errcode = 'P0001';
  end if;

  -- Phase 1: lock + validate every line, aggregate per sale_item_id
  for v_line in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_item_id := (v_line->>'sale_item_id')::bigint;
    v_qty     := (v_line->>'quantity')::numeric;
    v_unit    := (v_line->>'unit')::text;

    if v_item_id is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_quantity' using errcode = 'P0001';
    end if;

    -- Lock the sold line; serializes concurrent returns for the same line
    select si.sale_id, si.product_id, coalesce(si.base_qty, si.quantity, 0),
           si.selling_unit, si.subtotal, si.unit_price
      into v_sale_of_item, v_pid, v_sold_base, v_unit_default, v_subtotal_s, v_unit_price
      from public.sale_items si
     where si.id = v_item_id
     for update;
    if v_sale_of_item is null then
      raise exception 'sale_item_not_found:%', v_item_id using errcode = 'P0001';
    end if;
    if v_sale_of_item <> p_sale_id then
      raise exception 'sale_item_not_in_sale:%', v_item_id using errcode = 'P0001';
    end if;

    -- Lock the product row (co-operates with create_sale / receive / adjust)
    select sell_type, units_per_carton, kg_per_sack
      into v_rule, v_upc, v_kgs
      from public.products p
     where p.id = v_pid
     for update;
    if v_rule is null then
      raise exception 'product_not_found:%', v_pid using errcode = 'P0001';
    end if;

    if v_unit is null then
      v_unit := coalesce(v_unit_default, v_rule);
    end if;
    v_sale_base := public._to_base_quantity(v_rule, v_unit, v_qty, v_upc, v_kgs);

    -- accumulate qty per sale_item_id (same unit map later = sum of base)
    v_agg_base := coalesce((v_totals->>v_item_id::text)::numeric, 0);
    v_totals := jsonb_set(v_totals, ARRAY[v_item_id::text], to_jsonb(v_agg_base + v_sale_base));
  end loop;

  -- Check aggregated totals vs what was ALREADY returned from the DB
  for v_key in select jsonb_object_keys(v_totals)
  loop
    v_item_id := v_key::bigint;
    v_agg_base := (v_totals->>v_key)::numeric;

    select coalesce(si.base_qty, si.quantity, 0)
      into v_sold_base
      from public.sale_items si
     where si.id = v_item_id;

    select coalesce(sum(ri.base_qty), 0)
      into v_returned_base
      from public.return_items ri
      join public.returns r on r.id = ri.return_id
     where r.sale_id = p_sale_id
       and ri.sale_item_id = v_item_id;

    if v_returned_base + v_agg_base > v_sold_base then
      raise exception 'return_exceeds:%:%', v_item_id, (v_sold_base - v_returned_base)
        using errcode = 'P0001';
    end if;
  end loop;

  -- Phase 2: header + lines + stock restore + financial accumulation
  insert into public.returns (sale_id, employee_name, reason, client_request_id)
  values (p_sale_id, p_employee_name, p_reason, p_client_request_id)
  returning id into v_return_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_item_id := (v_line->>'sale_item_id')::bigint;
    v_qty     := (v_line->>'quantity')::numeric;
    v_unit    := (v_line->>'unit')::text;

    select si.selling_unit, si.product_id,
           coalesce(si.base_qty, si.quantity, 0), si.subtotal, si.unit_price, si.quantity
      into v_unit_default, v_pid, v_sold_base, v_subtotal_s, v_unit_price, v_qty_sold
      from public.sale_items si where si.id = v_item_id;

    select sell_type, units_per_carton, kg_per_sack
      into v_rule, v_upc, v_kgs
      from public.products where id = v_pid;

    if v_unit is null then
      v_unit := coalesce(v_unit_default, v_rule);
    end if;
    v_sale_base := _to_base_quantity(v_rule, v_unit, v_qty, v_upc, v_kgs);

    -- money = sale-time snapshots (unit price x sold qty) x returned/sold ratio
    v_line_total_s := round(coalesce(v_subtotal_s,
        round(coalesce(v_unit_price, 0) * coalesce(v_qty_sold, 0), 2)), 2);
    v_amount := round(v_line_total_s * (v_sale_base / NULLIF(v_sold_base, 0)), 2);
    v_amt_total := v_amt_total + v_amount;

    insert into public.return_items
           (return_id, sale_item_id, product_id, quantity, unit, base_qty, amount)
    values (v_return_id, v_item_id, v_pid, v_qty, v_unit, v_sale_base, v_amount);

    update public.products
       set stock     = stock     + v_sale_base,
           stock_qty = stock_qty + v_sale_base
     where id = v_pid;
  end loop;

  -- Financial net: original total_amount NEVER changes; the deduction lives
  -- in sales.returned_amount (net = total_amount - returned_amount).
  update public.sales
     set returned_amount = coalesce(returned_amount, 0) + v_amt_total
   where id = p_sale_id;

  return jsonb_build_object('id', v_return_id,
                            'sale_id', p_sale_id,
                            'employee_name', p_employee_name,
                            'returned_amount', v_amt_total,
                            'client_request_id', p_client_request_id);
end;
$$;

-- Only the backend service role may execute this RPC (same as create_sale)
revoke all on function public.create_return(bigint, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.create_return(bigint, text, jsonb, text, text) to service_role;

-- -------------------------------------------------------------------------
-- Verification (run after applying):
--   select proname from pg_proc where proname = 'create_return';
--   select table_name from information_schema.tables
--    where table_name in ('returns', 'return_items');
--   select column_name from information_schema.columns
--    where table_name in ('sales', 'return_items')
--      and column_name in ('returned_amount', 'amount');
-- -------------------------------------------------------------------------