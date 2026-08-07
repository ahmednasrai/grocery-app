-- ==== Rushdy Mart — Migration: Atomic Sale = Sale + Sale Items + Stock Deduction ====
-- Run in the Supabase SQL Editor (supabase.com/dashboard → SQL Editor → Run).
-- Makes the whole checkout a single PostgreSQL transaction via an RPC function:
--   - validates stock (SELECT ... FOR UPDATE -> row-level lock against race
--     conditions, e.g. two cashiers selling the last item concurrently)
--   - raises -> entire transaction aborts (no sale, no sale_items, no deduction)
--   - idempotency: a client_request_id column dedupes double-clicks / retries
--   - DB-level CHECK prevents negative inventory no matter what writes to it.

-- ---------------------------------------------------------------------
-- 1. Idempotency key on sales (optional nullable; unique when present)
-- ---------------------------------------------------------------------
alter table public.sales
  add column if not exists client_request_id text;

create unique index if not exists sales_client_request_id_key
  on public.sales (client_request_id)
  where client_request_id is not null;

-- ---------------------------------------------------------------------
-- 2. Database-level negative stock guard (defense in depth)
-- ---------------------------------------------------------------------
alter table public.products
  drop constraint if exists products_stock_non_negative;

alter table public.products
  add constraint products_stock_non_negative
  check (coalesce(stock, 0) >= 0 and coalesce(stock_qty, 0) >= 0);

-- ---------------------------------------------------------------------
-- 3. Atomic sale RPC
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
  v_price numeric;
  v_stock numeric;
  v_stock_qty numeric;
begin
  -- Idempotency: replay of the same request returns the original sale,
  -- never creates a second invoice and never deducts stock twice.
  if p_client_request_id is not null then
    select jsonb_build_object('id', s.id, 'employee_name', s.employee_name,
                              'total_amount', s.total_amount, 'client_request_id', s.client_request_id)
      into v_line
      from public.sales s
     where s.client_request_id = p_client_request_id;
    if v_line is not null then
      return jsonb_build_object('idempotent', true,
                                'id', (v_line->>'id')::bigint,
                                'employee_name', v_line->>'employee_name',
                                'total_amount', (v_line->>'total_amount')::numeric,
                                'client_request_id', p_client_request_id);
    end if;
  end if;

  -- Phase 1: validate + lock all product rows (no side effects yet)
  for v_line in select * from jsonb_array_elements(p_items)
  loop
    v_pid   := (v_line->>'product_id')::bigint;
    v_qty   := (v_line->>'quantity')::numeric;
    v_price := (v_line->>'price')::numeric;

    if v_qty is null or v_qty <= 0 then
      raise exception 'invalid_quantity' using errcode = 'P0001';
    end if;

    select coalesce(p.stock_qty, p.stock, 0)
      into v_stock_qty
      from public.products p
     where p.id = v_pid
     for update;

    if v_stock_qty is null then
      raise exception 'product_not_found:%', v_pid using errcode = 'P0001';
    end if;

    if v_stock_qty < v_qty then
      raise exception 'insufficient_stock:%:%', v_pid, v_stock_qty using errcode = 'P0001';
    end if;

    v_total := v_total + round(coalesce(v_price, 0) * v_qty, 2);
  end loop;

  -- Phase 2: write invoice
  insert into public.sales (employee_name, total_amount, client_request_id)
  values (p_employee_name, v_total, p_client_request_id)
  returning id into v_sale_id;

  -- Phase 3: write ledger lines + deduct stock (all in the same transaction)
  for v_line in select * from jsonb_array_elements(p_items)
  loop
    v_pid   := (v_line->>'product_id')::bigint;
    v_qty   := (v_line->>'quantity')::numeric;
    v_price := (v_line->>'price')::numeric;

    insert into public.sale_items (sale_id, product_id, quantity, unit_price, subtotal)
    values (v_sale_id, v_pid, v_qty, v_price, round(coalesce(v_price, 0) * v_qty, 2));

    update public.products
       set stock     = stock     - v_qty,
           stock_qty = stock_qty - v_qty
     where id = v_pid;
  end loop;

  return jsonb_build_object('id', v_sale_id,
                            'employee_name', p_employee_name,
                            'total_amount', v_total,
                            'client_request_id', p_client_request_id);
end;
$$;

-- Keep the RPC usable ONLY by the backend (service_role key), like every other
-- privileged write in supabase_setup.sql. The FastAPI endpoint enforces login +
-- the "pos" permission before ever calling it; browser/anonymous keys cannot.
revoke all on function public.create_sale(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_sale(text, jsonb, text) to service_role;

-- ---------------------------------------------------------------------
-- Verification queries (run after applying):
--   select proname, prosecdef from pg_proc where proname = 'create_sale';
--   select constraint_name from information_schema.table_constraints
--    where table_name = 'products' and constraint_name = 'products_stock_non_negative';
--   select column_name from information_schema.columns where table_name = 'sales' and column_name = 'client_request_id';
-- ---------------------------------------------------------------------