-- אוקי משפחה: RPC ליצירה/הצטרפות (מעקף RLS לחיפוש לפי invite_code)

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
  v_family_id uuid;
  v_code text;
  v_room text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  v_code := upper(regexp_replace(coalesce(p_invite_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(v_code) <> 6 then
    raise exception 'invalid_invite_code';
  end if;

  -- profile must exist (trigger on signup); soft-ensure for edge cases
  insert into public.profiles (id, display_name)
  values (v_uid, coalesce(nullif(trim(p_display_name), ''), 'מנהל'))
  on conflict (id) do nothing;

  v_room := 'family_' || v_code;

  insert into public.families (name, invite_code, created_by, livekit_room)
  values (
    coalesce(nullif(trim(p_name), ''), 'משפחה'),
    v_code,
    v_uid,
    v_room
  )
  returning id into v_family_id;

  insert into public.family_members (family_id, user_id, role, display_name)
  values (
    v_family_id,
    v_uid,
    'admin',
    coalesce(nullif(trim(p_display_name), ''), 'מנהל')
  );

  return v_family_id;
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
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  v_code := upper(regexp_replace(coalesce(p_invite_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(v_code) <> 6 then
    raise exception 'invalid_invite_code';
  end if;

  select f.id into v_family_id
  from public.families f
  where f.invite_code = v_code;

  if v_family_id is null then
    raise exception 'family_not_found';
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

  return v_family_id;
end;
$$;

revoke all on function public.create_oki_family(text, text, text) from public;
revoke all on function public.join_oki_family(text, text) from public;
grant execute on function public.create_oki_family(text, text, text) to authenticated;
grant execute on function public.join_oki_family(text, text) to authenticated;

comment on function public.create_oki_family is 'אוקי משפחה: יצירת משפחה + מנהל';
comment on function public.join_oki_family is 'אוקי משפחה: הצטרפות לפי קוד הזמנה';
