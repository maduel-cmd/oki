-- תרחישי אבטחה לאוקי משפחה. מריצים מול DB עם כל המיגרציות (ראו docs/DECISIONS_2026-11-13_he.md).
-- כל שורה מסומנת EXPECT: ERROR חייבת להיכשל; השאר חייבות להצליח.
\set ON_ERROR_STOP 0
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000001','dad@x'),('00000000-0000-4000-8000-000000000002','kid@x'),
 ('00000000-0000-4000-8000-000000000003','stranger@x'),('00000000-0000-4000-8000-000000000004','kid2@x'),
 ('00000000-0000-4000-8000-000000000005','otherdad@x');
set role authenticated;

\echo '== dad creates family; other dad creates another'
set test.uid='00000000-0000-4000-8000-000000000001';
select public.create_oki_family('מדואל','אבא','ABC234') as fam \gset
select invite_code as code from public.families where id=:'fam' \gset
select :'code' <> 'ABC234' as server_generated_code;
set test.uid='00000000-0000-4000-8000-000000000005';
select public.create_oki_family('אחרת','אבא אחר','XYZ789') as fam2 \gset

\echo '== kid joins: wrong code -> null, right code -> pending'
set test.uid='00000000-0000-4000-8000-000000000002';
select public.join_oki_family('ZZZZZZ','ילד') is null as wrong_code_null;
select public.join_oki_family(lower(:'code'),'ילד') = :'fam' as joined;
select approved as kid_approved_should_be_f from public.family_members where user_id=auth.uid();
\echo '== pending kid sees nothing but own row (expect 1,0,0,0)'
select count(*) from public.family_members;
select count(*) from public.families;
select count(*) from public.family_zones;
select count(*) from public.family_meeting_points;
\echo 'EXPECT: ERROR  pending kid approves self'
update public.family_members set approved=true where user_id=auth.uid();
\echo 'EXPECT: ERROR  pending kid self-promotes'
update public.family_members set role='admin' where user_id=auth.uid();
\echo 'EXPECT: ERROR  pending kid writes location / alert / meeting point'
insert into public.family_member_locations(family_id,user_id,lat,lng) values (:'fam',auth.uid(),1,1);
insert into public.family_alerts(family_id,kind,member_id,label) values (:'fam','zone_enter',auth.uid(),'x');
insert into public.family_meeting_points(family_id,name,geom,created_by) values (:'fam','x','p',auth.uid());

\echo '== dad approves kid'
set test.uid='00000000-0000-4000-8000-000000000001';
select count(*) as dad_sees_members_2 from public.family_members where family_id=:'fam';
update public.family_members set approved=true where user_id='00000000-0000-4000-8000-000000000002';
\echo 'EXPECT: ERROR  dad edits invite_code / livekit_room directly'
update public.families set invite_code='AAAAAA' where id=:'fam';
update public.families set livekit_room='family_XYZ789x' where id=:'fam';
update public.families set name='משפחת מדואל' where id=:'fam';
\echo 'EXPECT: ERROR  dad touches the other family'
update public.family_members set role='member' where family_id=:'fam2';
select count(*) as dad_sees_other_family_0 from public.family_members where family_id=:'fam2';
\echo 'EXPECT: ERROR  location request to a user outside the family'
insert into public.family_location_requests(family_id,from_admin_id,to_member_id) values (:'fam',auth.uid(),'00000000-0000-4000-8000-000000000003');
insert into public.family_location_requests(family_id,from_admin_id,to_member_id) values (:'fam',auth.uid(),'00000000-0000-4000-8000-000000000002') returning id as req \gset

\echo '== approved kid: normal use'
set test.uid='00000000-0000-4000-8000-000000000002';
select count(*) as kid_sees_members_2 from public.family_members;
\echo 'EXPECT: ERROR  kid self-promotes'
update public.family_members set role='admin' where user_id=auth.uid();
update public.family_members set display_name='נועה', quiet_preferred=true where user_id=auth.uid();
update public.family_members set last_lat=32, last_lng=34 where user_id=auth.uid();
select last_lat is null and last_lng is null as legacy_cols_null from public.family_members where user_id=auth.uid();
insert into public.family_member_locations(family_id,user_id,lat,lng,share_until) values (:'fam',auth.uid(),32.1,34.8, now()+interval '1 hour');
update public.family_location_requests set status='shared', resolved_at=now() where id=:'req';
\echo 'EXPECT: ERROR  kid redirects the request / rotates code / too-long name'
update public.family_location_requests set to_member_id='00000000-0000-4000-8000-000000000001' where id=:'req';
select public.rotate_oki_invite_code(:'fam');
update public.family_members set display_name=repeat('א',200) where user_id=auth.uid();

\echo '== kid2 joins, approved by dad, must NOT see kid location (expect 0)'
set test.uid='00000000-0000-4000-8000-000000000004';
select public.join_oki_family(:'code','אח') = :'fam' as joined;
set test.uid='00000000-0000-4000-8000-000000000001';
update public.family_members set approved=true where user_id='00000000-0000-4000-8000-000000000004';
set test.uid='00000000-0000-4000-8000-000000000004';
select count(*) as kid2_sees_locations_0 from public.family_member_locations;
select count(*) as kid2_sees_compounds_0 from public.family_compounds;
\echo 'EXPECT: ERROR  kid2 writes location for someone else'
insert into public.family_member_locations(family_id,user_id,lat,lng) values (:'fam','00000000-0000-4000-8000-000000000001',1,1);

\echo '== stranger'
set test.uid='00000000-0000-4000-8000-000000000003';
\echo 'EXPECT: ERROR  direct inserts'
insert into public.family_members(family_id,user_id,role,display_name) values (:'fam',auth.uid(),'admin','x');
insert into public.families(name,invite_code,created_by) values ('x','QQQQQQ',auth.uid());
select count(*) as stranger_sees_members_0 from public.family_members;
select public.join_oki_family('AAAAA'||g::text,'x') is null as miss from generate_series(1,8) g;
\echo 'EXPECT: ERROR  too_many_attempts (even with the right code)'
select public.join_oki_family(:'code','x');

\echo '== anon cannot call RPCs'
reset role; set role anon; set test.uid='';
\echo 'EXPECT: ERROR  permission denied x2'
select public.join_oki_family(:'code','x');
select public.create_oki_family('x','x','QWE234');
reset role; set role authenticated;

\echo '== dad: sees location, rotates code, last-admin protection, removes kid2'
set test.uid='00000000-0000-4000-8000-000000000001';
select count(*) as dad_sees_locations_1 from public.family_member_locations;
select public.rotate_oki_invite_code(:'fam') ~ '^[A-HJ-NP-Z2-9]{6}$' as rotated_ok;
select invite_code <> :'code' as code_changed from public.families where id=:'fam';
\echo 'EXPECT: ERROR  family_needs_admin'
update public.family_members set role='member' where user_id=auth.uid();
delete from public.family_members where user_id='00000000-0000-4000-8000-000000000004';
select count(*) as members_left_2 from public.family_members where family_id=:'fam';
insert into public.family_alerts(family_id,kind,member_id,label) values (:'fam','compound_enter',auth.uid(),'t');
