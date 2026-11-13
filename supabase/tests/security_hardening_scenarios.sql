\set ON_ERROR_STOP 0
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000001','dad@x'),('00000000-0000-4000-8000-000000000002','kid@x'),('00000000-0000-4000-8000-000000000003','stranger@x'),('00000000-0000-4000-8000-000000000004','kid2@x');
set role authenticated;
\echo '--- dad creates family'
set test.uid='00000000-0000-4000-8000-000000000001';
select public.create_oki_family('מדואל','אבא','ABC234') as fam \gset
\echo '--- kid joins with wrong code -> null'
set test.uid='00000000-0000-4000-8000-000000000002';
select public.join_oki_family('ZZZZZZ','ילד') is null as wrong_code_null;
select public.join_oki_family('abc234','ילד') = :'fam' as joined;
select public.join_oki_family('abc234','ילדה') = :'fam' as rejoin_ok;
\echo '--- kid tries self-promotion (expect ERROR)'
update public.family_members set role='admin' where user_id=auth.uid();
select role from public.family_members where user_id=auth.uid();
\echo '--- kid renames + quiet (expect ok)'
update public.family_members set display_name='נועה', quiet_preferred=true where user_id=auth.uid();
\echo '--- kid writes legacy location columns (expect nulls)'
update public.family_members set last_lat=32, last_lng=34 where user_id=auth.uid();
select last_lat,last_lng,display_name from public.family_members where user_id=auth.uid();
\echo '--- kid shares location in new table'
insert into public.family_member_locations(family_id,user_id,lat,lng) values (:'fam',auth.uid(),32.1,34.8) on conflict (family_id,user_id) do update set lat=excluded.lat,lng=excluded.lng,shared_at=now();
\echo '--- kid tries rotate (expect ERROR forbidden)'
select public.rotate_oki_invite_code(:'fam');
\echo '--- kid2 joins, must NOT see kid location (expect 0)'
set test.uid='00000000-0000-4000-8000-000000000004';
select public.join_oki_family('ABC234','אח') = :'fam' as joined;
select count(*) as kid2_sees_locations from public.family_member_locations;
\echo '--- kid2 writes location for someone else (expect ERROR)'
insert into public.family_member_locations(family_id,user_id,lat,lng) values (:'fam','00000000-0000-4000-8000-000000000001',1,1);
\echo '--- stranger direct insert as admin (expect ERROR rls)'
set test.uid='00000000-0000-4000-8000-000000000003';
insert into public.family_members(family_id,user_id,role,display_name) values (:'fam',auth.uid(),'admin','x');
insert into public.families(name,invite_code,created_by) values ('x','QQQQQQ',auth.uid());
select count(*) as stranger_sees_members from public.family_members;
\echo '--- stranger brute force: 8 nulls then ERROR too_many_attempts'
select public.join_oki_family('AAAAA'||g::text,'x') is null as miss from generate_series(1,7) g;
select public.join_oki_family('AAAAA9','x');
select public.join_oki_family('ABC234','x');
\echo '--- dad sees location (1), promotes kid, cannot demote last admin'
set test.uid='00000000-0000-4000-8000-000000000001';
select count(*) as dad_sees_locations from public.family_member_locations;
select public.rotate_oki_invite_code(:'fam') ~ '^[A-HJ-NP-Z2-9]{6}$' as rotated_ok;
select invite_code <> 'ABC234' as code_changed from public.families;
update public.family_members set role='member' where user_id=auth.uid();
update public.family_members set role='admin' where user_id='00000000-0000-4000-8000-000000000002';
update public.family_members set role='member' where user_id=auth.uid();
select display_name, role from public.family_members order by joined_at;
\echo '--- admin(kid now) removes kid2; location cascades'
delete from public.family_members where user_id='00000000-0000-4000-8000-000000000004';
select count(*) as members_left from public.family_members;
insert into public.family_alerts(family_id,kind,member_id,label) values (:'fam','compound_enter',auth.uid(),'t');
