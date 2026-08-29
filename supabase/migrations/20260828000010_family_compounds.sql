-- Closed compounds (מתחמים) for parent-only geofence alerts + admin-only line visibility

create table if not exists public.family_compounds (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null,
  geom geography(Polygon, 4326) not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists family_compounds_family_idx
  on public.family_compounds (family_id);
create index if not exists family_compounds_geom_idx
  on public.family_compounds using gist (geom);

alter table public.family_compounds enable row level security;

-- Parents only — members must not see compounds
drop policy if exists family_compounds_admin_select on public.family_compounds;
create policy family_compounds_admin_select on public.family_compounds
  for select to authenticated
  using (public.is_family_admin(family_id));

drop policy if exists family_compounds_admin_write on public.family_compounds;
create policy family_compounds_admin_write on public.family_compounds
  for all to authenticated
  using (public.is_family_admin(family_id))
  with check (public.is_family_admin(family_id) and created_by = auth.uid());

-- Boundary lines: parents only (same privacy as compounds)
drop policy if exists family_boundary_lines_select on public.family_boundary_lines;
create policy family_boundary_lines_select on public.family_boundary_lines
  for select to authenticated
  using (public.is_family_admin(family_id));

comment on table public.family_compounds is
  'Closed parent-only enclosures; enter/exit alerts admins';
