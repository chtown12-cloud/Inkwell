-- ═══════════════════════════════════════════════════════════════
-- INKWELL — Supabase Schema
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard)
-- ═══════════════════════════════════════════════════════════════

-- 1. Create the user_data table
create table if not exists public.user_data (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null unique,
  tasks jsonb default '[]'::jsonb,
  lists jsonb default '["Inbox","Work","Personal"]'::jsonb,
  settings jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- 2. Enable Row Level Security (RLS)
alter table public.user_data enable row level security;

-- 3. Users can only read/write their own row
create policy "Users can read own data"
  on public.user_data for select
  using (auth.uid() = user_id);

create policy "Users can insert own data"
  on public.user_data for insert
  with check (auth.uid() = user_id);

create policy "Users can update own data"
  on public.user_data for update
  using (auth.uid() = user_id);

-- 4. Auto-create a row when a new user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.user_data (user_id) values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5. Auto-update timestamp
create or replace function public.update_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_user_data_timestamp
  before update on public.user_data
  for each row execute function public.update_timestamp();
