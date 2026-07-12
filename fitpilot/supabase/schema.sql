-- FitPilot tables (run in Supabase SQL editor). Rows are stored as jsonb blobs
-- for simplicity; the backend uses the service_role key server-side only.
create table if not exists profile (
  id int primary key default 1,
  data jsonb not null
);
create table if not exists plans (
  week_start text primary key,
  data jsonb not null,
  updated_at timestamptz default now()
);
create table if not exists workout_logs (
  id bigint generated always as identity primary key,
  data jsonb not null,
  created_at timestamptz default now()
);
create table if not exists meal_logs (
  id bigint generated always as identity primary key,
  data jsonb not null,
  created_at timestamptz default now()
);
-- Keep RLS enabled; the backend uses the service_role key which bypasses it.
alter table profile enable row level security;
alter table plans enable row level security;
alter table workout_logs enable row level security;
alter table meal_logs enable row level security;
