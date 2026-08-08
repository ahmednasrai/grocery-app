-- ============================================================
-- Migration 006 — minimum_stock default = 10 for NEW products
-- Rushdy Mart. IDEMPOTENT — safe to run repeatedly.
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- ============================================================

-- Existing rows are NOT modified (12, 22, 23 stay 0 until the owner changes them).
-- Only future INSERTs (without an explicit minimum_stock) get 10 by default.
alter table public.products alter column minimum_stock set default 10;

-- Verify:
--   select column_name, column_default from information_schema.columns
--    where table_name = 'products' and column_name = 'minimum_stock';