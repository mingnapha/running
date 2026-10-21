-- =============================================================================
-- ทดสอบกฎธุรกิจและสิทธิ์ใน DB (รันหลัง migration + seed; ทุกอย่าง rollback ตอนจบ)
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/01_business_rules.sql
-- ใช้ assert ธรรมดา (ไม่ต้องติดตั้ง pgTAP) — ถ้าผิด จะ error พร้อมชื่อเทส
-- =============================================================================
\pset tuples_only on
\pset format unaligned
begin;
set local client_min_messages = warning;

create function pg_temp.auth_of(p_code text) returns uuid language sql security definer as
  $$ select auth_user_id from public.profiles where employee_code = p_code $$;
create function pg_temp.pid(p_code text) returns uuid language sql security definer as
  $$ select id from public.profiles where employee_code = p_code $$;

-- เปลี่ยนเป็นผู้ใช้คนนั้น (role authenticated + JWT sub) เหมือนที่ PostgREST ทำ
create function pg_temp.login(p_code text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(pg_temp.auth_of(p_code)::text, ''), true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function pg_temp.expect_error(p_name text, p_sql text, p_message text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm like p_message then
      raise notice 'ok   %', p_name; return;
    end if;
    raise exception 'FAIL % — expected "%", got "%" (%)', p_name, p_message, sqlerrm, sqlstate;
  end;
  raise exception 'FAIL % — expected error "%", but succeeded', p_name, p_message;
end $$;

create function pg_temp.check(p_name text, p_ok boolean) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FAIL %', p_name; end if;
  raise notice 'ok   %', p_name;
end $$;

create function pg_temp.ev(p_code text, p_sha text default null) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'object_key', 'evidence/' || pg_temp.pid(p_code) || '/' || gen_random_uuid() || '.webp',
    'content_sha256', coalesce(p_sha, encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex')),
    'mime_type', 'image/webp', 'byte_size', 150000))
$$;

grant execute on all functions in schema pg_temp to authenticated;

set local client_min_messages = notice;

-- -----------------------------------------------------------------------------
-- กฎ "ห้ามส่ง"
-- -----------------------------------------------------------------------------
select pg_temp.login('EMP001');

select pg_temp.expect_error('future date blocked',
  format($q$select public.submit_run(public.app_today() + 1, 5, 1800, null, %L)$q$, pg_temp.ev('EMP001')),
  'RUN_DATE_IN_FUTURE');
select pg_temp.expect_error('backdate > 7 days blocked',
  format($q$select public.submit_run(public.app_today() - 8, 5, 1800, null, %L)$q$, pg_temp.ev('EMP001')),
  'RUN_DATE_TOO_OLD');
select pg_temp.expect_error('distance below 0.1 km blocked',
  format($q$select public.submit_run(public.app_today(), 0.05, 60, null, %L)$q$, pg_temp.ev('EMP001')),
  'DISTANCE_BELOW_MIN');
select pg_temp.expect_error('evidence required',
  $q$select public.submit_run(public.app_today(), 5, 1800, null, '[]')$q$, 'EVIDENCE_REQUIRED');
select pg_temp.expect_error('evidence key must be under own folder',
  format($q$select public.submit_run(public.app_today(), 5, 1800, null, %L)$q$, pg_temp.ev('EMP002')),
  'INVALID_EVIDENCE_KEY');
select pg_temp.expect_error('date outside any active season blocked',
  format($q$select public.submit_run('2026-09-25', 5, 1800, null, %L)$q$, pg_temp.ev('EMP001')),
  'NO_ACTIVE_SEASON_FOR_DATE');
select pg_temp.expect_error('runner cannot insert runs directly',
  $q$insert into public.runs (user_id, season_id, rule_id, run_date, distance_km, duration_seconds)
     values (public.current_profile_id(), null, null, public.app_today(), 5, 1800)$q$, 'permission denied%');
select pg_temp.expect_error('runner cannot write ledger',
  $q$insert into public.point_ledger (season_id, user_id, entry_type, points, effective_at, reason)
     select id, public.current_profile_id(), 'manual_adjustment', 1000, now(), 'x' from public.seasons limit 1$q$,
  'permission denied%');
select pg_temp.expect_error('backdate exactly 7 days is allowed (boundary)',
  format($q$do $d$ begin perform public.submit_run(public.app_today() - 7, 0.1, 60, null, %L);
            raise exception 'BOUNDARY_OK'; end $d$$q$, pg_temp.ev('EMP001')),
  'BOUNDARY_OK');

-- -----------------------------------------------------------------------------
-- กฎ "ติดธง"
-- -----------------------------------------------------------------------------
create temp table t_ids (name text primary key, id uuid) on commit drop;
grant all on t_ids to authenticated;

insert into t_ids select 'fast', (public.submit_run(public.app_today(), 10, 1500, 'วิ่งเร็วมาก', pg_temp.ev('EMP001'))).id;
insert into t_ids select 'slow', (public.submit_run(public.app_today(), 1, 1500, null, pg_temp.ev('EMP001'))).id;
insert into t_ids select 'long', (public.submit_run(public.app_today() - 1, 45, 18000, null,
                                   pg_temp.ev('EMP001', repeat('a', 64)))).id;
insert into t_ids select 'dup',  (public.submit_run(public.app_today(), 1, 1500, null, pg_temp.ev('EMP001'))).id;
select pg_temp.logout();
select pg_temp.login('EMP002');
insert into t_ids select 'img',  (public.submit_run(public.app_today(), 5, 1800, null,
                                   pg_temp.ev('EMP002', repeat('a', 64)))).id;
insert into t_ids select 'clean', (public.submit_run(public.app_today(), 4.5, 1620, null, pg_temp.ev('EMP002'))).id;
select pg_temp.logout();

select pg_temp.check('pace < 3:00/km flagged',
  exists (select 1 from run_flags f join t_ids t on t.id = f.run_id where t.name = 'fast' and f.code = 'pace_too_fast'));
select pg_temp.check('pace > 20:00/km flagged',
  exists (select 1 from run_flags f join t_ids t on t.id = f.run_id where t.name = 'slow' and f.code = 'pace_too_slow'));
select pg_temp.check('distance > 42.2 km flagged',
  exists (select 1 from run_flags f join t_ids t on t.id = f.run_id where t.name = 'long' and f.code = 'distance_high'));
select pg_temp.check('same day + same distance flagged as duplicate',
  exists (select 1 from run_flags f join t_ids t on t.id = f.run_id where t.name = 'dup' and f.code = 'duplicate_entry'));
select pg_temp.check('same image hash across runs flagged',
  exists (select 1 from run_flags f join t_ids t on t.id = f.run_id where t.name = 'img' and f.code = 'duplicate_image'));
select pg_temp.check('clean run has no flags',
  not exists (select 1 from run_flags f join t_ids t on t.id = f.run_id where t.name = 'clean'));
select pg_temp.check('flagged runs are still pending (not auto-rejected)',
  (select bool_and(r.status = 'pending') from runs r join t_ids t on t.id = r.id));

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
select pg_temp.login('EMP001');
select pg_temp.check('runner sees only own runs',
  (select bool_and(user_id = public.current_profile_id()) from public.runs));
select pg_temp.check('runner cannot read flags', not exists (select 1 from public.run_flags));
select pg_temp.check('runner cannot read other profiles', (select count(*) from public.profiles) = 1);
select pg_temp.check('runner sees full leaderboard', (select count(*) from public.leaderboard) >= 16);
select pg_temp.check('public_profiles hides employee_code',
  not exists (select 1 from information_schema.columns
              where table_name = 'public_profiles' and column_name = 'employee_code'));
select pg_temp.expect_error('runner cannot approve',
  format($q$select public.review_run(%L, 'approved')$q$, (select id from t_ids where name = 'clean')), 'FORBIDDEN');
select pg_temp.expect_error('runner cannot close season',
  $q$select public.close_season('50000000-0000-4000-8000-000000000002')$q$, 'FORBIDDEN');
select pg_temp.expect_error('runner cannot update season (RLS)',
  $q$do $d$ begin update public.seasons set name_th = 'x';
     if found then raise exception 'UPDATED'; end if; raise exception 'NO_ROWS'; end $d$$q$, 'NO_ROWS');
select public.cancel_run((select id from t_ids where name = 'slow'));
select pg_temp.check('runner can cancel own pending run',
  (select status from public.runs where id = (select id from t_ids where name = 'slow')) = 'cancelled');
select pg_temp.logout();

-- -----------------------------------------------------------------------------
-- การอนุมัติ คะแนน อันดับ
-- -----------------------------------------------------------------------------
select pg_temp.login('EMP009');
select from public.submit_run(public.app_today(), 2, 720, null, pg_temp.ev('EMP009'));
select pg_temp.expect_error('approver cannot approve own run',
  $q$select public.review_run((select id from public.runs where user_id = public.current_profile_id()
                                and status = 'pending' limit 1), 'approved')$q$, 'CANNOT_REVIEW_OWN_RUN');
select pg_temp.expect_error('reject requires reason',
  format($q$select public.review_run(%L, 'rejected', '  ')$q$, (select id from t_ids where name = 'dup')),
  '%run_reviews_reason_required%');

create temp table t_before as select * from public.leaderboard_entries
  where season_id = '50000000-0000-4000-8000-000000000002';
select public.review_run((select id from t_ids where name = 'clean'), 'approved');  -- EMP002 +4.5 km
select pg_temp.logout();
select pg_temp.check('approval adds km × points_per_km to ledger',
  (select points from point_ledger where run_id = (select id from t_ids where name = 'clean')) = 45.00);
select pg_temp.check('leaderboard total updated',
  (select total_points from leaderboard_entries
   where season_id = '50000000-0000-4000-8000-000000000002' and user_id = pg_temp.pid('EMP002')) = 200.00);
select pg_temp.check('season leaderboard_version bumped',
  (select leaderboard_version from seasons where id = '50000000-0000-4000-8000-000000000002') > 17);
select pg_temp.login('EMP009');
select pg_temp.expect_error('cannot approve twice',
  format($q$select public.review_run(%L, 'approved')$q$, (select id from t_ids where name = 'clean')), 'RUN_NOT_PENDING');

-- bulk: ทั้งหมดหรือไม่มีเลย
select pg_temp.expect_error('bulk approve is atomic',
  format($q$select public.review_runs_bulk(array[%L, %L]::uuid[], 'approved')$q$,
         (select id from t_ids where name = 'fast'), (select id from t_ids where name = 'clean')),
  'RUN_NOT_PENDING');
select pg_temp.check('failed bulk left first run pending',
  (select status from runs where id = (select id from t_ids where name = 'fast')) = 'pending');
select pg_temp.check('bulk approve 2 runs',
  public.review_runs_bulk(array[(select id from t_ids where name = 'fast'), (select id from t_ids where name = 'long')],
                          'approved', null) = 2);
select pg_temp.check('EMP001 now leads (142 + 100 + 450)',
  (select user_id = pg_temp.pid('EMP001') and total_points = 692 from leaderboard_entries
   where season_id = '50000000-0000-4000-8000-000000000002' and rank = 1));
select pg_temp.check('previous_rank recorded when rank changes',
  (select previous_rank = 2 from leaderboard_entries
   where season_id = '50000000-0000-4000-8000-000000000002' and user_id = pg_temp.pid('EMP001')));

select public.review_run((select id from t_ids where name = 'long'), 'revoked', 'รูปเป็นการปั่นจักรยาน');
select pg_temp.logout();
select pg_temp.check('revoke writes negative ledger entry and keeps original',
  (select count(*) = 2 and sum(points) = 0 from point_ledger where run_id = (select id from t_ids where name = 'long')));

-- tie-break: ถึงคะแนนเท่ากันก่อน ได้อันดับดีกว่า
select pg_temp.check('tie broken by earlier reached_at (EMP004 before EMP003)',
  (select a.rank < b.rank and a.total_points = b.total_points
   from leaderboard_entries a, leaderboard_entries b
   where a.season_id = '50000000-0000-4000-8000-000000000002' and b.season_id = a.season_id
     and a.user_id = pg_temp.pid('EMP004') and b.user_id = pg_temp.pid('EMP003')));

-- ledger append-only (แม้ superuser)
select pg_temp.expect_error('ledger cannot be updated',
  $q$update public.point_ledger set points = 9999$q$, 'APPEND_ONLY');
select pg_temp.expect_error('ledger cannot be deleted',
  $q$delete from public.point_ledger$q$, 'APPEND_ONLY');
select pg_temp.expect_error('approved run values immutable',
  $q$update public.runs set distance_km = 99 where status = 'approved'$q$, 'RUN_IMMUTABLE');
select pg_temp.expect_error('closed season immutable',
  $q$update public.seasons set name_th = 'x' where status = 'closed'$q$, 'SEASON_CLOSED');
select pg_temp.expect_error('seasons cannot overlap',
  $q$insert into public.seasons (name_th, name_en, start_date, end_date) values ('x', 'x', '2026-12-01', '2027-01-31')$q$,
  '%seasons_no_overlap%');

-- -----------------------------------------------------------------------------
-- กติกาแบบเวอร์ชัน + คำนวณย้อนหลัง
-- -----------------------------------------------------------------------------
select pg_temp.login('EMP010');
insert into public.season_rules (season_id, points_per_km, change_reason)
values ('50000000-0000-4000-8000-000000000002', 12, 'เพิ่มแรงจูงใจช่วงปลายปี');
select pg_temp.check('rule version auto-increments',
  (public.current_rule('50000000-0000-4000-8000-000000000002')).version = 2);
select pg_temp.check('recalculate writes rule_recalc diffs', public.recalculate_season(
  '50000000-0000-4000-8000-000000000002', 'ใช้ 12 แต้ม/กม. ย้อนหลังทั้งฤดูกาล') > 0);
select pg_temp.check('totals follow new rate (EMP002 20.0 km × 12)',
  (select total_points from leaderboard_entries
   where season_id = '50000000-0000-4000-8000-000000000002' and user_id = pg_temp.pid('EMP002')) = 240.00);
select pg_temp.expect_error('season cannot be closed directly',
  $q$update public.seasons set status = 'closed' where status = 'active'$q$, 'USE_CLOSE_SEASON');
select pg_temp.expect_error('close blocked while runs pending',
  $q$select public.close_season('50000000-0000-4000-8000-000000000002')$q$, 'SEASON_HAS_PENDING_RUNS');

-- -----------------------------------------------------------------------------
-- PDPA
-- -----------------------------------------------------------------------------
select public.anonymize_user(pg_temp.pid('EMP005'));
select pg_temp.logout();
select pg_temp.check('anonymized user removed from all leaderboards',
  not exists (select 1 from leaderboard_entries e join profiles p on p.id = e.user_id where p.anonymized_at is not null));
select pg_temp.check('anonymized profile has no employee code / auth user',
  (select employee_code is null and auth_user_id is null and display_name = 'ผู้ใช้ที่ลบแล้ว'
   from profiles where anonymized_at is not null));
select pg_temp.check('anonymized user evidence scheduled for immediate purge',
  (select bool_and(e.purge_after <= now()) from evidence_files e join runs r on r.id = e.run_id
   join profiles p on p.id = r.user_id where p.anonymized_at is not null));
select pg_temp.check('ledger history kept after anonymize',
  exists (select 1 from point_ledger l join profiles p on p.id = l.user_id where p.anonymized_at is not null));
select pg_temp.check('audit log never stores employee_code',
  not exists (select 1 from audit_logs where entity_type = 'profiles'
              and (before_data ->> 'employee_code' ~ '^EMP' or after_data ->> 'employee_code' ~ '^EMP')));

-- login lockout
select public.record_login_attempt(repeat('b', 64), null, false) from generate_series(1, 5);
select pg_temp.check('locked after 5 failures', public.is_login_locked(repeat('b', 64)));
select pg_temp.check('other user not locked', not public.is_login_locked(repeat('c', 64)));

\echo 'ALL DB TESTS PASSED'
rollback;
