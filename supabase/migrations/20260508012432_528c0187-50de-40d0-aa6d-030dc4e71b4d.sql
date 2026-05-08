
-- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles viewable by authenticated" on public.profiles for select to authenticated using (true);
create policy "users update own profile" on public.profiles for update to authenticated using (auth.uid() = id);
create policy "users insert own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);

-- auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- sites
create table public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamptz not null default now()
);
alter table public.sites enable row level security;
create policy "sites read" on public.sites for select to authenticated using (true);
create policy "sites insert" on public.sites for insert to authenticated with check (true);
create policy "sites update" on public.sites for update to authenticated using (true);
create policy "sites delete" on public.sites for delete to authenticated using (true);

-- equipment
create type public.equipment_status as enum ('available','checked_out','maintenance');
create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,
  identifier text not null unique,
  status public.equipment_status not null default 'available',
  latitude double precision not null,
  longitude double precision not null,
  site_id uuid references public.sites(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.equipment enable row level security;
create policy "equipment read" on public.equipment for select to authenticated using (true);
create policy "equipment insert" on public.equipment for insert to authenticated with check (true);
create policy "equipment update" on public.equipment for update to authenticated using (true);
create policy "equipment delete" on public.equipment for delete to authenticated using (true);

-- checkouts (key check-outs)
create table public.checkouts (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  checked_out_at timestamptz not null default now(),
  returned_at timestamptz,
  notes text
);
alter table public.checkouts enable row level security;
create policy "checkouts read" on public.checkouts for select to authenticated using (true);
create policy "checkouts insert" on public.checkouts for insert to authenticated with check (auth.uid() = user_id);
create policy "checkouts update" on public.checkouts for update to authenticated using (true);

-- audit log
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  equipment_id uuid references public.equipment(id) on delete set null,
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_log enable row level security;
create policy "audit read" on public.audit_log for select to authenticated using (true);
create policy "audit insert" on public.audit_log for insert to authenticated with check (true);
