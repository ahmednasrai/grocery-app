-- ============================================================
-- Migration 007 — Soft delete for products (is_active)
-- Rushdy Mart. IDEMPOTENT — safe to run repeatedly.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- ============================================================

-- Purpose:
--   Products with past sale_items MUST NOT be hard-deleted (that would
--   break historical invoices). Instead we archive them:
--     is_active = true  -> visible everywhere (POS, Inventory, add-to-invoice)
--     is_active = false -> archived: hidden from POS + add-to-invoice pages,
--                          but still rendered in past invoices/sales reports.
--
-- Existing rows are NOT modified: every current product stays is_active = true.
alter table public.products add column if not exists is_active boolean not null default true;

create index if not exists idx_products_is_active on public.products (is_active);

-- Verify:
--   select id, name, is_active from products order by id limit 10;
--   (all existing products should show is_active = true / t)