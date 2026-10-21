-- =============================================================================
-- workingRun — seed data สำหรับ dev/staging (ห้ามใช้บน production)
--   10 คน · 3 แผนก · 2 ฤดูกาล (ฤดูกาล 1 ปิดแล้ว, ฤดูกาล 2 เปิดอยู่)
--   รหัสผ่านทุกบัญชี: WorkingRun#2569  (บังคับเปลี่ยนเมื่อล็อกอินครั้งแรก)
--
-- ตัวอย่างที่ครอบคลุม:
--   - กติกาเวอร์ชัน 2 (8 แต้ม/กม.) ในฤดูกาล 1
--   - อันดับเท่ากัน (EMP003 กับ EMP004 = 80 แต้ม ในฤดูกาล 2 — EMP004 ถึงก่อน)
--   - ปฏิเสธพร้อมเหตุผล, เพิกถอนหลังอนุมัติ, ปรับคะแนนด้วยมือ
--   - รายการติดธง: pace เร็วผิดปกติ, รายการซ้ำ
--   - รูปหลักฐานของฤดูกาล 1 ถูกลบตามนโยบาย 90 วันแล้ว
-- =============================================================================
begin;

select set_config('app.bypass_run_rules', 'on', true);

-- -----------------------------------------------------------------------------
-- แผนก
-- -----------------------------------------------------------------------------
insert into public.departments (id, code, name_th, name_en) values
  ('d0000000-0000-4000-8000-000000000001', 'IT',    'เทคโนโลยีสารสนเทศ', 'Information Technology'),
  ('d0000000-0000-4000-8000-000000000002', 'HR',    'ทรัพยากรบุคคล',     'Human Resources'),
  ('d0000000-0000-4000-8000-000000000003', 'SALES', 'ฝ่ายขาย',           'Sales');

-- -----------------------------------------------------------------------------
-- ผู้ใช้ (auth.users + identities + profiles + roles)
-- -----------------------------------------------------------------------------
create temp table seed_people (n int, code text, name text, dept text, roles public.app_role[]) on commit drop;
insert into seed_people values
  ( 1, 'EMP001', 'ธนพล ส.',        'IT',    '{runner}'),
  ( 2, 'EMP002', 'สุดารัตน์ ก.',    'HR',    '{runner}'),
  ( 3, 'EMP003', 'วิทยา พ.',        'SALES', '{runner}'),
  ( 4, 'EMP004', 'ณัฐชา ร.',        'IT',    '{runner}'),
  ( 5, 'EMP005', 'กิตติพงษ์ ม.',    'SALES', '{runner}'),
  ( 6, 'EMP006', 'พิมพ์ชนก ท.',     null,    '{runner}'),
  ( 7, 'EMP007', 'อรรถพล จ.',       'HR',    '{runner}'),
  ( 8, 'EMP008', 'ปวีณา ช.',        null,    '{runner}'),
  ( 9, 'EMP009', 'ศิริพร ล.',       'HR',    '{runner,approver}'),
  (10, 'EMP010', 'ประเสริฐ ว.',     'IT',    '{runner,admin}');

create or replace function pg_temp.auth_id(p_n int) returns uuid language sql immutable as
  $$ select ('a0000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.profile_id(p_code text) returns uuid language sql immutable as
  $$ select ('10000000-0000-4000-8000-' || lpad(substr(p_code, 4), 12, '0'))::uuid $$;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.auth_id(n), 'authenticated', 'authenticated',
       lower(code) || '@users.workingrun.internal',
       extensions.crypt('WorkingRun#2569', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', now(), now()
from seed_people;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select pg_temp.auth_id(n), pg_temp.auth_id(n), pg_temp.auth_id(n)::text, 'email',
       jsonb_build_object('sub', pg_temp.auth_id(n)::text, 'email', lower(code) || '@users.workingrun.internal'),
       now(), now(), now()
from seed_people;

insert into public.profiles (id, auth_user_id, employee_code, display_name, department_id)
select pg_temp.profile_id(sp.code), pg_temp.auth_id(sp.n), sp.code, sp.name, d.id
from seed_people sp left join public.departments d on d.code = sp.dept;

insert into public.user_roles (user_id, role, granted_by)
select pg_temp.profile_id(sp.code), r, pg_temp.profile_id('EMP010')
from seed_people sp, unnest(sp.roles) r;

-- -----------------------------------------------------------------------------
-- Helpers สำหรับ seed
-- -----------------------------------------------------------------------------
-- ทำงานในนามผู้ใช้ (เหมือน JWT ที่ PostgREST ตั้งให้)
create or replace function pg_temp.act_as(p_code text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.auth_id(substr(p_code, 4)::int)::text, true)
$$;

-- บันทึกการวิ่ง + รูป แล้วตรวจตาม p_decision (null = ค้างตรวจ)
create or replace function pg_temp.seed_run(
  p_code text, p_date date, p_km numeric, p_minutes numeric, p_submitted_at timestamptz,
  p_decision public.review_decision default 'approved', p_reason text default null)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.runs (user_id, season_id, rule_id, run_date, distance_km, duration_seconds, submitted_at)
  values (pg_temp.profile_id(p_code), null, null, p_date, p_km, round(p_minutes * 60)::int, p_submitted_at)
  returning id into v_id;

  insert into public.evidence_files (run_id, object_key, content_sha256, mime_type, byte_size, uploaded_at)
  values (v_id, 'evidence/' || pg_temp.profile_id(p_code) || '/' || v_id || '.webp',
          encode(extensions.digest(v_id::text, 'sha256'), 'hex'), 'image/webp', 120000 + (random() * 60000)::int,
          p_submitted_at);

  if p_decision is not null then
    perform pg_temp.act_as('EMP009');
    perform public.review_run(v_id, p_decision, p_reason);
  end if;
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- ฤดูกาล 1: 1 ก.ค. – 30 ก.ย. 2569 (ปิดแล้ว)
-- -----------------------------------------------------------------------------
insert into public.seasons (id, name_th, name_en, start_date, end_date, created_by) values
  ('50000000-0000-4000-8000-000000000001', 'ฤดูกาล 1/2569', 'Season 1/2026', '2026-07-01', '2026-09-30',
   pg_temp.profile_id('EMP010'));

insert into public.season_rules (season_id, version, points_per_km, change_reason, created_by)
values ('50000000-0000-4000-8000-000000000001', 0, 8, 'ฤดูกาลแรกใช้ 8 แต้ม/กม.', pg_temp.profile_id('EMP010'));

update public.seasons set status = 'active' where id = '50000000-0000-4000-8000-000000000001';

insert into public.season_participants (season_id, user_id, added_by)
select '50000000-0000-4000-8000-000000000001', pg_temp.profile_id(code), pg_temp.profile_id('EMP010')
from seed_people where n <= 8;

select pg_temp.seed_run('EMP001', '2026-07-03',  5.0, 32, '2026-07-03 12:10+00');
select pg_temp.seed_run('EMP001', '2026-08-14', 10.0, 61, '2026-08-14 11:00+00');
select pg_temp.seed_run('EMP001', '2026-09-20',  8.4, 50, '2026-09-20 01:30+00');
select pg_temp.seed_run('EMP002', '2026-07-05', 21.1, 135, '2026-07-05 03:00+00');
select pg_temp.seed_run('EMP002', '2026-08-02',  5.0, 30, '2026-08-02 12:00+00');
select pg_temp.seed_run('EMP003', '2026-07-12',  3.0, 21, '2026-07-12 10:15+00');
select pg_temp.seed_run('EMP003', '2026-09-01', 12.5, 80, '2026-09-01 10:40+00');
select pg_temp.seed_run('EMP004', '2026-07-20', 15.0, 95, '2026-07-20 00:45+00');
select pg_temp.seed_run('EMP004', '2026-09-28',  6.0, 38, '2026-09-28 11:20+00');
select pg_temp.seed_run('EMP005', '2026-08-08',  4.2, 30, '2026-08-08 12:30+00');
select pg_temp.seed_run('EMP006', '2026-07-30',  7.5, 52, '2026-07-30 23:50+00');
select pg_temp.seed_run('EMP007', '2026-08-21', 10.0, 58, '2026-08-21 10:05+00');
select pg_temp.seed_run('EMP008', '2026-09-10',  2.0, 16, '2026-09-10 11:45+00');
select pg_temp.seed_run('EMP008', '2026-09-11', 30.0, 150, '2026-09-11 12:00+00', 'rejected',
                        'ระยะในรูปหลักฐานคือ 3.0 กม. กรุณาส่งใหม่');

select pg_temp.act_as('EMP010');
select public.close_season('50000000-0000-4000-8000-000000000001', 'ครบกำหนดฤดูกาล');

-- -----------------------------------------------------------------------------
-- ฤดูกาล 2: 1 ต.ค. – 31 ธ.ค. 2569 (เปิดอยู่, 10 แต้ม/กม.)
-- -----------------------------------------------------------------------------
insert into public.seasons (id, name_th, name_en, start_date, end_date, created_by) values
  ('50000000-0000-4000-8000-000000000002', 'ฤดูกาล 2/2569', 'Season 2/2026', '2026-10-01', '2026-12-31',
   pg_temp.profile_id('EMP010'));
update public.seasons set status = 'active' where id = '50000000-0000-4000-8000-000000000002';

select public.copy_participants('50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002');
insert into public.season_participants (season_id, user_id, added_by)
select '50000000-0000-4000-8000-000000000002', pg_temp.profile_id(code), pg_temp.profile_id('EMP010')
from seed_people where n in (9, 10);

-- อนุมัติแล้ว
select pg_temp.seed_run('EMP001', '2026-10-02',  5.0, 31, '2026-10-02 11:30+00');
select pg_temp.seed_run('EMP001', '2026-10-10',  3.0, 19, '2026-10-10 12:05+00');
select pg_temp.seed_run('EMP001', '2026-10-15',  6.2, 40, '2026-10-15 11:40+00');
select pg_temp.seed_run('EMP002', '2026-10-03', 10.0, 62, '2026-10-03 00:20+00');
select pg_temp.seed_run('EMP002', '2026-10-12',  5.5, 33, '2026-10-12 23:55+00');
select pg_temp.seed_run('EMP003', '2026-10-06',  4.0, 27, '2026-10-06 11:10+00');
select pg_temp.seed_run('EMP003', '2026-10-14',  4.0, 26, '2026-10-14 11:15+00');
select pg_temp.seed_run('EMP004', '2026-10-05',  7.0, 45, '2026-10-05 01:00+00');
select pg_temp.seed_run('EMP004', '2026-10-11',  1.0,  7, '2026-10-11 10:30+00');
select pg_temp.seed_run('EMP005', '2026-10-08', 12.0, 75, '2026-10-08 23:00+00');
select pg_temp.seed_run('EMP006', '2026-10-04',  2.5, 20, '2026-10-04 12:00+00');
select pg_temp.seed_run('EMP006', '2026-10-13',  2.5, 19, '2026-10-13 12:10+00');
select pg_temp.seed_run('EMP007', '2026-10-09',  9.0, 54, '2026-10-09 10:50+00');
select pg_temp.seed_run('EMP010', '2026-10-07',  6.0, 39, '2026-10-07 11:25+00');

-- ปฏิเสธพร้อมเหตุผล
select pg_temp.seed_run('EMP005', '2026-10-09', 21.1, 120, '2026-10-09 23:10+00', 'rejected',
                        'วันที่ในรูปหลักฐานไม่ตรงกับวันที่บันทึก');

-- อนุมัติแล้วถูกเพิกถอน (บันทึกซ้ำกับรายการ 10 ต.ค.)
select pg_temp.seed_run('EMP001', '2026-10-10', 4.0, 25, '2026-10-10 12:30+00');
select pg_temp.act_as('EMP009');
select public.review_run(r.id, 'revoked', 'ซ้ำกับรายการวันที่ 10 ต.ค. ที่อนุมัติไปแล้ว')
from public.runs r
where r.user_id = pg_temp.profile_id('EMP001') and r.run_date = '2026-10-10' and r.distance_km = 4.0;

-- ปรับคะแนนด้วยมือโดยแอดมิน
select pg_temp.act_as('EMP010');
select public.adjust_points('50000000-0000-4000-8000-000000000002', pg_temp.profile_id('EMP006'), 5,
                            'ชดเชยรายการที่ระบบอัปโหลดรูปขัดข้อง 13 ต.ค.');

-- ค้างตรวจ (ติดธงบางรายการ)
select pg_temp.seed_run('EMP003', '2026-10-20',  3.0, 20, '2026-10-20 11:00+00', null);
select pg_temp.seed_run('EMP007', '2026-10-19', 15.0, 40, '2026-10-19 12:00+00', null);  -- pace 2:40 → pace_too_fast
select pg_temp.seed_run('EMP008', '2026-10-19',  3.2, 22, '2026-10-19 11:30+00', null);
select pg_temp.seed_run('EMP008', '2026-10-19',  3.2, 22, '2026-10-19 11:32+00', null);  -- duplicate_entry
select pg_temp.seed_run('EMP002', '2026-10-21',  8.0, 48, '2026-10-21 00:30+00', null);

-- -----------------------------------------------------------------------------
-- รูปหลักฐานที่เกิน 90 วัน (ฤดูกาล 1 ช่วงต้น) ถือว่า job ลบไฟล์ไปแล้ว
-- -----------------------------------------------------------------------------
select public.mark_evidence_purged(array_agg(id)) from public.evidence_due_for_purge(1000);

select set_config('request.jwt.claim.sub', '', true);
commit;
