-- אוקי משפחה — אישור הצטרפות, שיתוף מיקום מוגבל בזמן, והקשחות נוספות (2026-11-13)
--
-- 1. מצטרף חדש ממתין לאישור הורה: בלי אישור אין קריאה, אין ערוץ קול.
-- 2. שדות רגישים במשפחה (invite_code / livekit_room / created_by) נעולים לעדכון ישיר.
-- 3. «מצב טיול»: שיתוף מיקום עד share_until, רק אחרי אישור של בעל המיקום.
-- 4. בקשות מיקום: רק סטטוס משתנה; מגבלות אורך על טקסט חופשי; RPCs לא לאנונימיים.
--
-- Depends on: 20261113000011

-- ─── 1. join approval ────────────────────────────────────────────────────
alter table public.family_members
  add column if not exists approved boolean not null default true;

create or replace function public.is_family_member(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.family_members m
    where m.family_id = p_family_id and m.user_id = auth.uid() and m.approved
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
      and m.approved
  );
$$;

-- A pending member sees only their own row (to know they are waiting).
drop policy if exists family_members_select on public.family_members;
create policy family_members_select on public.family_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_family_member(family_id));

create or replace function public.family_members_guard()
returns trigger
language plpgsql
-- INVOKER on purpose: current_user must be the calling role, so that our
-- SECURITY DEFINER RPCs (running as the owner) pass and end users do not.
security invoker
set search_path = public
as $$
begin
  new.last_lat := null;
  new.last_lng := null;

  -- Service role / SQL editor / our own SECURITY DEFINER RPCs.
  if auth.uid() is null or current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.family_id is distinct from old.family_id
     or new.user_id is distinct from old.user_id then
    raise exception 'family_member_identity_immutable';
  end if;

  if new.approved is distinct from old.approved then
    if not public.is_family_admin(old.family_id) or old.user_id = auth.uid() then
      raise exception 'only_admin_can_approve';
    end if;
  end if;

  if new.role is distinct from old.role then
    if not public.is_family_admin(old.family_id) then
      raise exception 'only_admin_can_change_role';
    end if;
    if not new.approved then
      raise exception 'member_not_approved';
    end if;
    if old.role = 'admin' and new.role <> 'admin' and not exists (
      select 1 from public.family_members m
      where m.family_id = old.family_id
        and m.role = 'admin'
        and m.approved
        and m.user_id <> old.user_id
    ) then
      raise exception 'family_needs_admin';
    end if;
  end if;

  return new;
end;
$$;

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
  v_name text;
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

  v_name := left(coalesce(nullif(trim(p_display_name), ''), 'בן משפחה'), 40);

  if exists (
    select 1 from public.family_members m
    where m.family_id = v_family_id and m.user_id = v_uid
  ) then
    update public.family_members
      set display_name = v_name
      where family_id = v_family_id and user_id = v_uid;
    return v_family_id;
  end if;

  select count(*) into v_members
  from public.family_members m
  where m.family_id = v_family_id;
  if v_members >= 12 then
    raise exception 'family_full';
  end if;

  insert into public.profiles (id, display_name)
  values (v_uid, v_name)
  on conflict (id) do nothing;

  -- New joiners wait for a parent to approve them.
  insert into public.family_members (family_id, user_id, role, display_name, approved)
  values (v_family_id, v_uid, 'member', v_name, false);

  insert into public.family_join_attempts (user_id, ok) values (v_uid, true);
  delete from public.family_join_attempts
  where attempted_at < now() - interval '7 days';

  return v_family_id;
end;
$$;

-- ─── 2. lock sensitive family columns ────────────────────────────────────
create or replace function public.families_guard()
returns trigger
language plpgsql
-- INVOKER on purpose: current_user must be the calling role, so that our
-- SECURITY DEFINER RPCs (running as the owner) pass and end users do not.
security invoker
set search_path = public
as $$
begin
  -- Only direct end-user updates are restricted (RPCs run as the owner).
  if auth.uid() is null or current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.invite_code is distinct from old.invite_code
     or new.livekit_room is distinct from old.livekit_room
     or new.created_by is distinct from old.created_by then
    raise exception 'family_field_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists families_guard_trg on public.families;
create trigger families_guard_trg
  before update on public.families
  for each row execute function public.families_guard();

-- ─── 3. time-boxed location sharing ──────────────────────────────────────
alter table public.family_member_locations
  add column if not exists share_until timestamptz;

comment on column public.family_member_locations.share_until is
  'Member agreed to keep sharing until this time (trip mode); NULL = one-off share';

-- ─── 4. misc hardening ───────────────────────────────────────────────────
-- Location requests: after creation only status / resolved_at may change,
-- and the target must be an approved member of the same family.
create or replace function public.family_location_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.family_members m
      where m.family_id = new.family_id
        and m.user_id = new.to_member_id
        and m.approved
    ) then
      raise exception 'target_not_in_family';
    end if;
    return new;
  end if;
  if new.family_id is distinct from old.family_id
     or new.from_admin_id is distinct from old.from_admin_id
     or new.to_member_id is distinct from old.to_member_id
     or new.created_at is distinct from old.created_at then
    raise exception 'location_request_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists family_location_requests_guard_trg on public.family_location_requests;
create trigger family_location_requests_guard_trg
  before insert or update on public.family_location_requests
  for each row execute function public.family_location_requests_guard();

-- Free-text length limits (NOT VALID: existing rows are not re-checked).
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('families', 'name', 60),
      ('family_members', 'display_name', 40),
      ('family_zones', 'name', 60),
      ('family_boundary_lines', 'name', 60),
      ('family_compounds', 'name', 60),
      ('family_meeting_points', 'name', 60),
      ('family_alerts', 'label', 140)
    ) as t(tbl, col, max_len)
  loop
    execute format(
      'alter table public.%I drop constraint if exists %I',
      r.tbl, r.tbl || '_' || r.col || '_len');
    execute format(
      'alter table public.%I add constraint %I check (char_length(%I) <= %s) not valid',
      r.tbl, r.tbl || '_' || r.col || '_len', r.col, r.max_len);
  end loop;
end $$;

-- Supabase grants EXECUTE to anon by default; these are for signed-in users only.
revoke all on function public.create_oki_family(text, text, text) from anon, public;
revoke all on function public.join_oki_family(text, text) from anon, public;
revoke all on function public.rotate_oki_invite_code(uuid) from anon, public;
revoke all on function public.oki_random_invite_code() from anon, authenticated, public;
grant execute on function public.create_oki_family(text, text, text) to authenticated;
grant execute on function public.join_oki_family(text, text) to authenticated;
grant execute on function public.rotate_oki_invite_code(uuid) to authenticated;

-- ─── 5. invite code is always generated by the server ────────────────────
-- p_invite_code is kept for signature compatibility and ignored.
create or replace function public.create_oki_family(
  p_name text,
  p_display_name text,
  p_invite_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_family_id uuid := gen_random_uuid();
  v_name text;
  v_try int := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if (select count(*) from public.families f where f.created_by = v_uid) >= 5 then
    raise exception 'too_many_families';
  end if;

  v_name := left(coalesce(nullif(trim(p_display_name), ''), 'מנהל'), 40);

  insert into public.profiles (id, display_name)
  values (v_uid, v_name)
  on conflict (id) do nothing;

  loop
    v_try := v_try + 1;
    begin
      insert into public.families (id, name, invite_code, created_by, livekit_room)
      values (
        v_family_id,
        left(coalesce(nullif(trim(p_name), ''), 'משפחה'), 60),
        public.oki_random_invite_code(),
        v_uid,
        'oki_family_' || v_family_id::text
      );
      exit;
    exception when unique_violation then
      if v_try >= 5 then
        raise;
      end if;
    end;
  end loop;

  insert into public.family_members (family_id, user_id, role, display_name, approved)
  values (v_family_id, v_uid, 'admin', v_name, true);

  return v_family_id;
end;
$$;

revoke all on function public.create_oki_family(text, text, text) from anon, public;
grant execute on function public.create_oki_family(text, text, text) to authenticated;
