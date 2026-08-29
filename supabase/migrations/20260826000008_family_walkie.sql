-- Family Walkie (אוקי משפחה) — groups, zones, boundary lines, location requests, alerts
-- Depends on: public.profiles

create type public.family_role as enum ('admin', 'member');
create type public.family_location_request_status as enum (
  'pending', 'shared', 'denied', 'expired'
);
create type public.family_alert_kind as enum (
  'boundary_crossed', 'zone_enter', 'zone_exit', 'location_shared', 'quiet_blocked'
);

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by uuid not null references public.profiles (id) on delete restrict,
  livekit_room text unique,
  created_at timestamptz not null default now()
);

create index families_invite_code_idx on public.families (invite_code);

create table public.family_members (
  family_id uuid not null references public.families (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.family_role not null default 'member',
  display_name text not null,
  quiet_preferred boolean not null default false,
  last_lat double precision,
  last_lng double precision,
  last_seen_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

create index family_members_user_idx on public.family_members (user_id);

-- Circular geofences (e.g. home). force_audio = quiet mode forbidden inside.
create table public.family_zones (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null,
  center geography(Point, 4326) not null,
  radius_m int not null default 150
    check (radius_m between 50 and 5000),
  force_audio boolean not null default true,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index family_zones_family_idx on public.family_zones (family_id);
create index family_zones_center_idx on public.family_zones using gist (center);

-- Boundary "lines" — crossing notifies admins
create table public.family_boundary_lines (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null,
  geom geography(LineString, 4326) not null,
  alert_within_m int not null default 40
    check (alert_within_m between 10 and 500),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index family_boundary_lines_family_idx on public.family_boundary_lines (family_id);
create index family_boundary_lines_geom_idx on public.family_boundary_lines using gist (geom);

create table public.family_location_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  from_admin_id uuid not null references public.profiles (id) on delete cascade,
  to_member_id uuid not null references public.profiles (id) on delete cascade,
  status public.family_location_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index family_location_requests_family_idx
  on public.family_location_requests (family_id, status);

create table public.family_alerts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  kind public.family_alert_kind not null,
  member_id uuid not null references public.profiles (id) on delete cascade,
  label text not null,
  geom geography(Point, 4326),
  created_at timestamptz not null default now(),
  read_by_admin boolean not null default false
);

create index family_alerts_family_idx on public.family_alerts (family_id, created_at desc);

-- ─── helpers ─────────────────────────────────────────────
create or replace function public.is_family_member(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.family_members m
    where m.family_id = p_family_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_family_admin(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.family_members m
    where m.family_id = p_family_id
      and m.user_id = auth.uid()
      and m.role = 'admin'
  );
$$;

-- ─── RLS ─────────────────────────────────────────────────
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.family_zones enable row level security;
alter table public.family_boundary_lines enable row level security;
alter table public.family_location_requests enable row level security;
alter table public.family_alerts enable row level security;

-- families
create policy families_select_member on public.families
  for select to authenticated
  using (public.is_family_member(id));

create policy families_insert_self on public.families
  for insert to authenticated
  with check (created_by = auth.uid());

create policy families_update_admin on public.families
  for update to authenticated
  using (public.is_family_admin(id))
  with check (public.is_family_admin(id));

create policy families_delete_admin on public.families
  for delete to authenticated
  using (public.is_family_admin(id));

-- members: see own family; insert self on join / creator; update self or admin
create policy family_members_select on public.family_members
  for select to authenticated
  using (public.is_family_member(family_id));

create policy family_members_insert on public.family_members
  for insert to authenticated
  with check (
    user_id = auth.uid()
    or public.is_family_admin(family_id)
  );

create policy family_members_update on public.family_members
  for update to authenticated
  using (
    user_id = auth.uid()
    or public.is_family_admin(family_id)
  )
  with check (
    user_id = auth.uid()
    or public.is_family_admin(family_id)
  );

create policy family_members_delete on public.family_members
  for delete to authenticated
  using (
    user_id = auth.uid()
    or public.is_family_admin(family_id)
  );

-- zones: members read; admins write
create policy family_zones_select on public.family_zones
  for select to authenticated
  using (public.is_family_member(family_id));

create policy family_zones_admin_write on public.family_zones
  for all to authenticated
  using (public.is_family_admin(family_id))
  with check (public.is_family_admin(family_id) and created_by = auth.uid());

-- boundary lines
create policy family_boundary_lines_select on public.family_boundary_lines
  for select to authenticated
  using (public.is_family_member(family_id));

create policy family_boundary_lines_admin_write on public.family_boundary_lines
  for all to authenticated
  using (public.is_family_admin(family_id))
  with check (public.is_family_admin(family_id) and created_by = auth.uid());

-- location requests
create policy family_location_requests_select on public.family_location_requests
  for select to authenticated
  using (
    public.is_family_member(family_id)
    and (
      from_admin_id = auth.uid()
      or to_member_id = auth.uid()
      or public.is_family_admin(family_id)
    )
  );

create policy family_location_requests_admin_insert on public.family_location_requests
  for insert to authenticated
  with check (
    public.is_family_admin(family_id)
    and from_admin_id = auth.uid()
  );

create policy family_location_requests_update on public.family_location_requests
  for update to authenticated
  using (
    to_member_id = auth.uid()
    or public.is_family_admin(family_id)
  )
  with check (
    to_member_id = auth.uid()
    or public.is_family_admin(family_id)
  );

-- alerts: members insert (own events); admins read/update
create policy family_alerts_select on public.family_alerts
  for select to authenticated
  using (
    public.is_family_admin(family_id)
    or member_id = auth.uid()
  );

create policy family_alerts_insert on public.family_alerts
  for insert to authenticated
  with check (
    public.is_family_member(family_id)
    and member_id = auth.uid()
  );

create policy family_alerts_admin_update on public.family_alerts
  for update to authenticated
  using (public.is_family_admin(family_id))
  with check (public.is_family_admin(family_id));

comment on table public.families is 'Family Walkie groups (אוקי משפחה)';
comment on column public.family_zones.force_audio is 'Inside this zone quiet/mute mode is disabled';
comment on table public.family_boundary_lines is 'Virtual lines; crossing notifies family admins';
