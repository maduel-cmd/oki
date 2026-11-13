-- אוקי משפחה — הקשחת אבטחה ופרטיות (2026-11-13)
--
-- 1. חבר משפחה לא יכול לשנות לעצמו role (הסלמת הרשאות).
-- 2. אין הכנסה ישירה ל-family_members / families — רק דרך ה-RPCs.
-- 3. מיקום משותף עובר לטבלה נפרדת שנראית רק לבעל המיקום ולהורים (נעילה 3).
-- 4. קוד הזמנה: הגבלת ניסיונות, תקרת חברים, החלפת קוד ע"י הורה.
-- 5. סוגי התראה חדשים למתחמים.
--
-- Depends on: 20260826000008, 20260826000009, 20260828000010, 20260829153000

-- ─── 5. alert kinds (must not be used inside this migration) ─────────────
alter type public.family_alert_kind add value if not exists 'compound_enter';
alter type public.family_alert_kind add value if not exists 'compound_exit';

-- ─── 1. guard on family_members updates ──────────────────────────────────
create or replace function public.family_members_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Legacy location columns are retired: never store coordinates here
  -- (every family member can read this table).
  new.last_lat := null;
  new.last_lng := null;

  -- Service role / SQL editor: no end-user context, allow.
  if auth.uid() is null then
    return new;
  end if;

  if new.family_id is distinct from old.family_id
     or new.user_id is distinct from old.user_id then
    raise exception 'family_member_identity_immutable';
  end if;

  if new.role is distinct from old.role then
    if not public.is_family_admin(old.family_id) then
      raise exception 'only_admin_can_change_role';
    end if;
    -- Do not allow removing the last admin of a family.
    if old.role = 'admin' and new.role <> 'admin' and not exists (
      select 1 from public.family_members m
      where m.family_id = old.family_id
        and m.role = 'admin'
        and m.user_id <> old.user_id
    ) then
      raise exception 'family_needs_admin';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists family_members_guard_trg on public.family_members;
create trigger family_members_guard_trg
  before update on public.family_members
  for each row execute function public.family_members_guard();

-- ─── 2. no direct inserts — create/join only through SECURITY DEFINER RPCs ─
drop policy if exists family_members_insert on public.family_members;
drop policy if exists families_insert_self on public.families;

-- ─── 3. shared locations: owner + admins only ────────────────────────────
create table if not exists public.family_member_locations (
  family_id uuid not null,
  user_id uuid not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  shared_at timestamptz not null default now(),
  primary key (family_id, user_id),
  foreign key (family_id, user_id)
    references public.family_members (family_id, user_id) on delete cascade
);

alter table public.family_member_locations enable row level security;

drop policy if exists family_member_locations_select on public.family_member_locations;
create policy family_member_locations_select on public.family_member_locations
  for select to authenticated
  using (user_id = auth.uid() or public.is_family_admin(family_id));

drop policy if exists family_member_locations_insert on public.family_member_locations;
create policy family_member_locations_insert on public.family_member_locations
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_family_member(family_id));

drop policy if exists family_member_locations_update on public.family_member_locations;
create policy family_member_locations_update on public.family_member_locations
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_family_member(family_id));

drop policy if exists family_member_locations_delete on public.family_member_locations;
create policy family_member_locations_delete on public.family_member_locations
  for delete to authenticated
  using (user_id = auth.uid() or public.is_family_admin(family_id));

-- Move what was already shared, then blank the world-readable columns.
insert into public.family_member_locations (family_id, user_id, lat, lng, shared_at)
select m.family_id, m.user_id, m.last_lat, m.last_lng, coalesce(m.last_seen_at, now())
from public.family_members m
where m.last_lat is not null and m.last_lng is not null
on conflict (family_id, user_id) do nothing;

update public.family_members
set last_lat = null, last_lng = null
where last_lat is not null or last_lng is not null;

comment on table public.family_member_locations is
  'Location shared on request — readable by the member and family admins only';

-- ─── 4. invite codes ─────────────────────────────────────────────────────
create table if not exists public.family_join_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  ok boolean not null,
  attempted_at timestamptz not null default now()
);
create index if not exists family_join_attempts_user_idx
  on public.family_join_attempts (user_id, attempted_at desc);
-- RLS on, no policies: only SECURITY DEFINER functions touch this table.
alter table public.family_join_attempts enable row level security;

/** 6 chars from an unambiguous 32-letter alphabet, from gen_random_uuid() bytes. */
create or replace function public.oki_random_invite_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := uuid_send(gen_random_uuid());
  v_out text := '';
  i int;
begin
  -- bytes 0..5 of a v4 UUID are fully random; 256 % 32 = 0 → no bias
  for i in 0..5 loop
    v_out := v_out || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % 32), 1);
  end loop;
  return v_out;
end;
$$;

/**
 * Join by invite code.
 * Returns NULL (not an exception) when the code is unknown, so the failed
 * attempt is recorded and counted. Raises too_many_attempts / family_full.
 */
create or replace function public.join_oki_family(
  p_invite_code text,
  p_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_family_id uuid;
  v_code text;
  v_failed int;
  v_members int;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  v_code := upper(regexp_replace(coalesce(p_invite_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(v_code) <> 6 then
    raise exception 'invalid_invite_code';
  end if;

  select count(*) into v_failed
  from public.family_join_attempts a
  where a.user_id = v_uid
    and not a.ok
    and a.attempted_at > now() - interval '1 hour';
  if v_failed >= 8 then
    raise exception 'too_many_attempts';
  end if;

  select f.id into v_family_id
  from public.families f
  where f.invite_code = v_code;

  if v_family_id is null then
    insert into public.family_join_attempts (user_id, ok) values (v_uid, false);
    return null;
  end if;

  if not exists (
    select 1 from public.family_members m
    where m.family_id = v_family_id and m.user_id = v_uid
  ) then
    select count(*) into v_members
    from public.family_members m
    where m.family_id = v_family_id;
    if v_members >= 12 then
      raise exception 'family_full';
    end if;
  end if;

  insert into public.profiles (id, display_name)
  values (v_uid, coalesce(nullif(trim(p_display_name), ''), 'בן משפחה'))
  on conflict (id) do nothing;

  insert into public.family_members (family_id, user_id, role, display_name)
  values (
    v_family_id,
    v_uid,
    'member',
    coalesce(nullif(trim(p_display_name), ''), 'בן משפחה')
  )
  on conflict (family_id, user_id) do update
    set display_name = excluded.display_name;

  insert into public.family_join_attempts (user_id, ok) values (v_uid, true);
  delete from public.family_join_attempts
  where attempted_at < now() - interval '7 days';

  return v_family_id;
end;
$$;

/** Admin replaces the invite code (old code stops working immediately). */
create or replace function public.rotate_oki_invite_code(p_family_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_try int := 0;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_family_admin(p_family_id) then
    raise exception 'forbidden';
  end if;

  loop
    v_try := v_try + 1;
    v_code := public.oki_random_invite_code();
    begin
      update public.families set invite_code = v_code where id = p_family_id;
      return v_code;
    exception when unique_violation then
      if v_try >= 5 then
        raise;
      end if;
    end;
  end loop;
end;
$$;

revoke all on function public.join_oki_family(text, text) from public;
revoke all on function public.rotate_oki_invite_code(uuid) from public;
revoke all on function public.oki_random_invite_code() from public;
grant execute on function public.join_oki_family(text, text) to authenticated;
grant execute on function public.rotate_oki_invite_code(uuid) to authenticated;

comment on function public.rotate_oki_invite_code is
  'אוקי משפחה: החלפת קוד הזמנה ע"י הורה';
