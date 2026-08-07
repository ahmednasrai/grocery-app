-- ==== Rushdy Mart — Supabase Setup SQL ====
-- Run these statements in the Supabase SQL Editor (supabase.com/dashboard → SQL Editor).
-- They will NOT break the existing products / sales / sale_items schema.
-- All privileged writes are performed by the BACKEND using the service role key,
-- so the browser (anon/authenticated keys) is restricted to safe read-only rows.

-- ------------------------------------------------------------------
-- 1. Application profiles: links Supabase Auth users to roles/permissions
-- ------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'employee' check (role in ('admin','employee')),
  is_active boolean not null default true,
  permissions jsonb not null default '["pos"]'::jsonb,
  created_at timestamptz not null default now()
);

-- Automatically create a default (employee, POS-only) profile whenever a new
-- auth user is created from the Supabase dashboard or via signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ------------------------------------------------------------------
-- 2. Privileges
-- ------------------------------------------------------------------
-- service_role: full access on application tables (used by the backend).
-- authenticated: read-only on products/sales and own profile row selected.
revoke all on public.profiles from anon, authenticated;
revoke all on public.products, public.sales, public.sale_items from anon;

grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;
grant select on public.products, public.sales, public.sale_items to authenticated;
grant select, insert, update, delete on public.products, public.sales, public.sale_items to service_role;

-- ------------------------------------------------------------------
-- 3. Row Level Security
-- ------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;

-- Users can only see their own profile row.
create policy "user selects own profile" on public.profiles
  for select using (auth.uid() = id);

-- IMPORTANT: no UPDATE policy for authenticated users on profiles.
-- A user must NEVER be able to change their own role/permissions directly;
-- only the backend (service role) can, and only an admin may trigger it.

-- Read-only visibility for authenticated clients (the frontend itself no
-- longer queries these tables directly; this is defense-in-depth only).
create policy "authenticated read products" on public.products
  for select using (auth.role() = 'authenticated');

create policy "authenticated read sales" on public.sales
  for select using (auth.role() = 'authenticated');

create policy "authenticated read sale_items" on public.sale_items
  for select using (auth.role() = 'authenticated');

-- ------------------------------------------------------------------
-- 4. Create the first ADMIN account
-- ------------------------------------------------------------------
-- Step 1: create the user from the Dashboard (Authentication → Users → Add user,
--         or just log in once if signups are enabled).
-- Step 2: run the statement below with the actual email to promote them:
update public.profiles set role = 'admin' where email = 'you@example.com';

-- Afterwards: log in from the app UI to use the /users page to create employees.