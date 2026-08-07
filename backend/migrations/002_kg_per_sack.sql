-- ==== Rushdy Mart — Migration: separate kg_per_sack from units_per_carton ====
-- Run in the Supabase SQL Editor (supabase.com/dashboard → SQL Editor → Run).
-- Safe: additive (adds one nullable column), backfills existing sack rows,
-- and nulls out legacy unit data left in units_per_carton.

-- 1. Add the dedicated, nullable kg-per-sack column (no-op if already added).
alter table public.products
  add column if not exists kg_per_sack numeric;

-- 2. Backfill: for existing 'sack' products the sack weight was stored in
--    units_per_carton — move it to the dedicated column.
update public.products
   set kg_per_sack    = units_per_carton,
       units_per_carton = null
 where sell_type = 'sack'
   and units_per_carton is not null;

-- 3. Cleanup legacy sentinel values: piece/kg/liter rows used to store 1
--    in units_per_carton; the new model keeps it null for these types.
update public.products
   set units_per_carton = null
 where sell_type in ('piece', 'kg', 'liter');

-- 4. Verify (should show: carton → units_per_carton filled, sack → kg_per_sack
--    filled, and no row populated in both).
select id, name, sell_type, units_per_carton, kg_per_sack
  from public.products
 order by id;