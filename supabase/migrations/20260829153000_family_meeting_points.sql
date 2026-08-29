-- Manual meeting points (נקודות מפגש) — visible to all family members

do $$ begin
  alter type public.family_alert_kind add value 'meeting_point';
exception
  when duplicate_object then null;
end $$;

create table if not exists public.family_meeting_points (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null,
  geom geography(Point, 4326) not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists family_meeting_points_family_idx
  on public.family_meeting_points (family_id);
create index if not exists family_meeting_points_geom_idx
  on public.family_meeting_points using gist (geom);

alter table public.family_meeting_points enable row level security;

drop policy if exists family_meeting_points_select on public.family_meeting_points;
create policy family_meeting_points_select on public.family_meeting_points
  for select to authenticated
  using (public.is_family_member(family_id));

drop policy if exists family_meeting_points_insert on public.family_meeting_points;
create policy family_meeting_points_insert on public.family_meeting_points
  for insert to authenticated
  with check (
    public.is_family_member(family_id)
    and created_by = auth.uid()
  );

drop policy if exists family_meeting_points_delete on public.family_meeting_points;
create policy family_meeting_points_delete on public.family_meeting_points
  for delete to authenticated
  using (
    public.is_family_admin(family_id)
    or created_by = auth.uid()
  );

comment on table public.family_meeting_points is
  'Manual rendezvous pins (e.g. gate 12); visible to all family members';
