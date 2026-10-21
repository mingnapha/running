-- =============================================================================
-- workingRun — functions & triggers (กฎธุรกิจ คะแนน อันดับ audit PDPA)
--
-- รหัส error ที่ API แปลงเป็นข้อความ 2 ภาษา: ใช้ SQLSTATE 'WR001' + MESSAGE เป็นรหัส
--   เช่น RUN_DATE_IN_FUTURE, RUN_DATE_TOO_OLD, DISTANCE_BELOW_MIN, ...
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- "วันนี้" ตามเวลากรุงเทพฯ — ห้ามใช้ current_date (เป็น UTC บน Supabase)
create or replace function public.app_today()
returns date language sql stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Bangkok')::date $$;

create or replace function public.raise_app_error(p_code text, p_detail jsonb default null)
returns void language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'WR001', message = p_code, detail = coalesce(p_detail::text, '');
end $$;

-- อนุญาตข้ามกฎวันที่/สถานะฤดูกาล เฉพาะการ seed/นำเข้าข้อมูลโดย superuser หรือ service_role
create or replace function public.rules_bypassed()
returns boolean language sql stable
set search_path = ''
as $$
  -- session_user (ไม่ใช่ current_user) เพราะใน SECURITY DEFINER current_user เป็น postgres เสมอ
  -- ผ่าน PostgREST session_user คือ authenticator จึงข้ามกฎไม่ได้
  select coalesce(current_setting('app.bypass_run_rules', true), '') = 'on'
     and session_user in ('postgres', 'supabase_admin')
$$;

create or replace function public.current_profile_id()
returns uuid language sql stable security definer
set search_path = ''
as $$
  select p.id from public.profiles p
  where p.auth_user_id = auth.uid() and p.deleted_at is null and p.is_active
$$;

create or replace function public.has_role(p_role public.app_role)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = public.current_profile_id() and r.role = p_role)
$$;

create or replace function public.is_reviewer()
returns boolean language sql stable
set search_path = ''
as $$ select public.has_role('approver') or public.has_role('admin') $$;

-- ผู้กระทำสำหรับ audit: ผู้ใช้ที่ล็อกอิน หรือ app.actor_id ที่ service_role ตั้งให้
create or replace function public.audit_actor()
returns uuid language sql stable
set search_path = ''
as $$
  select coalesce(public.current_profile_id(), nullif(current_setting('app.actor_id', true), '')::uuid)
$$;

create or replace function public.current_rule(p_season_id uuid)
returns public.season_rules language sql stable
set search_path = ''
as $$
  select r.* from public.season_rules r
  where r.season_id = p_season_id
  order by r.version desc limit 1
$$;

create or replace function public.compute_points(p_distance_km numeric, p_points_per_km numeric)
returns numeric language sql immutable
set search_path = ''
as $$ select round(p_distance_km * p_points_per_km, 2) $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql
set search_path = ''
as $$ begin new.updated_at := now(); return new; end $$;

create trigger departments_touch before update on public.departments
  for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger seasons_touch before update on public.seasons
  for each row execute function public.touch_updated_at();
create trigger runs_touch before update on public.runs
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Append-only: ledger, reviews, audit
-- -----------------------------------------------------------------------------
create or replace function public.forbid_mutation()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  -- อนุญาตเฉพาะ job ลบ audit log ที่หมดอายุ (purge_expired_audit_logs)
  if tg_op = 'DELETE' and tg_table_name = 'audit_logs'
     and current_setting('app.audit_purge', true) = 'on' then
    return old;
  end if;
  perform public.raise_app_error('APPEND_ONLY', jsonb_build_object('table', tg_table_name));
  return null;
end $$;

create trigger point_ledger_append_only before update or delete on public.point_ledger
  for each row execute function public.forbid_mutation();
create trigger run_reviews_append_only before update or delete on public.run_reviews
  for each row execute function public.forbid_mutation();
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function public.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Audit (generic) — TG_ARGV = คอลัมน์ที่เป็นข้อมูลส่วนบุคคล ให้บันทึกแค่ว่า "เปลี่ยน"
-- -----------------------------------------------------------------------------
create or replace function public.audit_trigger()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  v_before jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_after  jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_col    text;
  v_id     text;
begin
  foreach v_col in array coalesce(tg_argv, '{}'::text[]) loop
    if v_before ? v_col then v_before := v_before || jsonb_build_object(v_col, '[redacted]'); end if;
    if v_after ? v_col then
      v_after := v_after || jsonb_build_object(v_col,
        case when tg_op = 'UPDATE' and (to_jsonb(old) -> v_col) is distinct from (to_jsonb(new) -> v_col)
             then '[changed]' else '[redacted]' end);
    end if;
  end loop;

  v_id := coalesce(v_after ->> 'id', v_before ->> 'id',
                   concat_ws(':', coalesce(v_after, v_before) ->> 'season_id', coalesce(v_after, v_before) ->> 'user_id'));

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data, reason)
  values (public.audit_actor(), lower(tg_op), tg_table_name, v_id, v_before, v_after,
          nullif(current_setting('app.audit_reason', true), ''));
  return null;
end $$;

create trigger departments_audit after insert or update or delete on public.departments
  for each row execute function public.audit_trigger();
create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function public.audit_trigger('employee_code', 'display_name');
create trigger user_roles_audit after insert or update or delete on public.user_roles
  for each row execute function public.audit_trigger();
-- ไม่บันทึกการเพิ่ม leaderboard_version (เกิดทุกครั้งที่อนุมัติ — ledger บันทึกไว้แล้ว)
create trigger seasons_audit
  after insert or delete or update of name_th, name_en, start_date, end_date, status, review_grace_days, deleted_at
  on public.seasons
  for each row execute function public.audit_trigger();
create trigger season_rules_audit after insert on public.season_rules
  for each row execute function public.audit_trigger();
create trigger season_participants_audit after insert or update or delete on public.season_participants
  for each row execute function public.audit_trigger();
create trigger runs_audit after insert or update of status on public.runs
  for each row execute function public.audit_trigger('note');
create trigger system_settings_audit after update on public.system_settings
  for each row execute function public.audit_trigger();
create trigger ddr_audit after insert or update on public.data_deletion_requests
  for each row execute function public.audit_trigger('note');

create or replace function public.set_audit_reason(p_reason text)
returns void language sql
set search_path = ''
as $$ select set_config('app.audit_reason', coalesce(p_reason, ''), true) $$;

-- -----------------------------------------------------------------------------
-- ฤดูกาล
-- -----------------------------------------------------------------------------
create or replace function public.seasons_guard()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'closed' and (new is distinct from old)
       and not (new.leaderboard_version <> old.leaderboard_version
                and (to_jsonb(new) - 'leaderboard_version' - 'updated_at')
                    = (to_jsonb(old) - 'leaderboard_version' - 'updated_at')) then
      perform public.raise_app_error('SEASON_CLOSED');
    end if;
    if new.status <> old.status and not (
         (old.status = 'draft' and new.status = 'active')
      or (old.status = 'active' and new.status = 'closed')) then
      perform public.raise_app_error('INVALID_SEASON_TRANSITION',
        jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    if new.deleted_at is not null and old.deleted_at is null and old.status <> 'draft' then
      perform public.raise_app_error('SEASON_DELETE_ONLY_DRAFT');
    end if;
    if new.status = 'closed' and old.status <> 'closed' then
      -- ปิดฤดูกาลต้องผ่าน close_season() ที่ตรวจคิวค้างก่อน
      if coalesce(current_setting('app.closing_season', true), '') <> 'on' then
        perform public.raise_app_error('USE_CLOSE_SEASON');
      end if;
      new.closed_at := now();
      new.closed_by := public.audit_actor();
    end if;
  else
    new.created_by := coalesce(new.created_by, public.audit_actor());
    if new.status = 'closed' then
      perform public.raise_app_error('INVALID_SEASON_TRANSITION');
    end if;
  end if;
  return new;
end $$;

create trigger seasons_guard before insert or update on public.seasons
  for each row execute function public.seasons_guard();

-- ทุกฤดูกาลใหม่ได้กติกาเวอร์ชัน 1 (ค่าเริ่มต้นของคอลัมน์) ทันที
create or replace function public.seasons_default_rules()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.season_rules (season_id, version, created_by)
  values (new.id, 1, new.created_by);
  return null;
end $$;

create trigger seasons_default_rules after insert on public.seasons
  for each row execute function public.seasons_default_rules();

create or replace function public.season_rules_before_insert()
returns trigger language plpgsql
set search_path = ''
as $$
declare v_status public.season_status;
begin
  select s.status into v_status from public.seasons s where s.id = new.season_id for update;
  if v_status = 'closed' then
    perform public.raise_app_error('SEASON_CLOSED');
  end if;
  select coalesce(max(r.version), 0) + 1 into new.version
  from public.season_rules r where r.season_id = new.season_id;
  new.created_by := coalesce(new.created_by, public.audit_actor());
  return new;
end $$;

create trigger season_rules_before_insert before insert on public.season_rules
  for each row execute function public.season_rules_before_insert();

-- -----------------------------------------------------------------------------
-- รายการวิ่ง: กฎ "ห้ามส่ง"
-- -----------------------------------------------------------------------------
create or replace function public.runs_before_insert()
returns trigger language plpgsql
set search_path = ''
as $$
declare
  v_season public.seasons;
  v_rule   public.season_rules;
  v_today  date := public.app_today();
  v_bypass boolean := public.rules_bypassed();
begin
  select s.* into v_season from public.seasons s
  where s.deleted_at is null
    and new.run_date between s.start_date and s.end_date
    and (s.status = 'active' or v_bypass);
  if v_season.id is null then
    perform public.raise_app_error('NO_ACTIVE_SEASON_FOR_DATE', jsonb_build_object('run_date', new.run_date));
  end if;
  if new.season_id is not null and new.season_id <> v_season.id then
    perform public.raise_app_error('SEASON_MISMATCH');
  end if;
  new.season_id := v_season.id;

  if not exists (select 1 from public.season_participants sp
                 where sp.season_id = v_season.id and sp.user_id = new.user_id and sp.removed_at is null) then
    perform public.raise_app_error('NOT_A_PARTICIPANT');
  end if;

  v_rule := public.current_rule(v_season.id);
  new.rule_id := v_rule.id;

  if new.distance_km < v_rule.min_distance_km then
    perform public.raise_app_error('DISTANCE_BELOW_MIN', jsonb_build_object('min', v_rule.min_distance_km));
  end if;

  if not v_bypass then
    if new.run_date > v_today then
      perform public.raise_app_error('RUN_DATE_IN_FUTURE');
    end if;
    if new.run_date < v_today - v_rule.max_backdate_days then
      perform public.raise_app_error('RUN_DATE_TOO_OLD', jsonb_build_object('max_days', v_rule.max_backdate_days));
    end if;
    new.submitted_at := now();
    new.status := 'pending';
    new.decided_at := null;
  end if;
  new.created_at := now();
  return new;
end $$;

create trigger runs_before_insert before insert on public.runs
  for each row execute function public.runs_before_insert();

-- เปลี่ยนได้เฉพาะ status/decided_at/note ตามลำดับสถานะที่ถูกต้อง
create or replace function public.runs_before_update()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if (new.user_id, new.season_id, new.rule_id, new.run_date, new.distance_km, new.duration_seconds, new.submitted_at)
     is distinct from
     (old.user_id, old.season_id, old.rule_id, old.run_date, old.distance_km, old.duration_seconds, old.submitted_at) then
    perform public.raise_app_error('RUN_IMMUTABLE');
  end if;
  if new.status <> old.status then
    if not ((old.status = 'pending' and new.status in ('approved', 'rejected', 'cancelled'))
         or (old.status = 'approved' and new.status = 'revoked')) then
      perform public.raise_app_error('INVALID_RUN_TRANSITION',
        jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    new.decided_at := case when new.status = 'cancelled' then null else now() end;
  end if;
  return new;
end $$;

create trigger runs_before_update before update on public.runs
  for each row execute function public.runs_before_update();

-- ต้องมีรูปหลักฐานอย่างน้อย 1 รูป — ตรวจตอน commit (รูปถูก insert หลังรายการวิ่งใน transaction เดียวกัน)
create or replace function public.runs_require_evidence()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.evidence_files e where e.run_id = new.id) then
    perform public.raise_app_error('EVIDENCE_REQUIRED');
  end if;
  return null;
end $$;

create constraint trigger runs_require_evidence after insert on public.runs
  deferrable initially deferred
  for each row execute function public.runs_require_evidence();

-- -----------------------------------------------------------------------------
-- รายการวิ่ง: กฎ "ติดธง" (ไม่ปฏิเสธอัตโนมัติ)
-- -----------------------------------------------------------------------------
create or replace function public.runs_compute_flags()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  v_rule  public.season_rules;
  v_daily numeric;
begin
  select r.* into v_rule from public.season_rules r where r.id = new.rule_id;

  if v_rule.flag_min_pace_sec_per_km is not null and new.pace_sec_per_km < v_rule.flag_min_pace_sec_per_km then
    insert into public.run_flags (run_id, code, detail) values (new.id, 'pace_too_fast',
      jsonb_build_object('pace_sec_per_km', new.pace_sec_per_km, 'threshold', v_rule.flag_min_pace_sec_per_km));
  end if;
  if v_rule.flag_max_pace_sec_per_km is not null and new.pace_sec_per_km > v_rule.flag_max_pace_sec_per_km then
    insert into public.run_flags (run_id, code, detail) values (new.id, 'pace_too_slow',
      jsonb_build_object('pace_sec_per_km', new.pace_sec_per_km, 'threshold', v_rule.flag_max_pace_sec_per_km));
  end if;
  if v_rule.flag_max_distance_km is not null and new.distance_km > v_rule.flag_max_distance_km then
    insert into public.run_flags (run_id, code, detail) values (new.id, 'distance_high',
      jsonb_build_object('distance_km', new.distance_km, 'threshold', v_rule.flag_max_distance_km));
  end if;

  select coalesce(sum(r.distance_km), 0) into v_daily from public.runs r
  where r.user_id = new.user_id and r.run_date = new.run_date and r.status in ('pending', 'approved');
  if v_rule.flag_max_daily_km is not null and v_daily > v_rule.flag_max_daily_km then
    insert into public.run_flags (run_id, code, detail) values (new.id, 'daily_total_high',
      jsonb_build_object('daily_km', v_daily, 'threshold', v_rule.flag_max_daily_km));
  end if;

  if exists (select 1 from public.runs r
             where r.user_id = new.user_id and r.run_date = new.run_date and r.id <> new.id
               and r.distance_km = new.distance_km and r.status in ('pending', 'approved')) then
    insert into public.run_flags (run_id, code, detail) values (new.id, 'duplicate_entry',
      jsonb_build_object('run_date', new.run_date, 'distance_km', new.distance_km));
  end if;
  return null;
end $$;

create trigger runs_compute_flags after insert on public.runs
  for each row execute function public.runs_compute_flags();

-- -----------------------------------------------------------------------------
-- รูปหลักฐาน
-- -----------------------------------------------------------------------------
create or replace function public.evidence_before_insert()
returns trigger language plpgsql
set search_path = ''
as $$
declare
  v_max   smallint;
  v_count int;
begin
  select r.max_evidence_files into v_max
  from public.runs ru join public.season_rules r on r.id = ru.rule_id
  where ru.id = new.run_id;
  select count(*) into v_count from public.evidence_files e where e.run_id = new.run_id;
  if v_count >= v_max then
    perform public.raise_app_error('TOO_MANY_EVIDENCE_FILES', jsonb_build_object('max', v_max));
  end if;
  if not public.rules_bypassed() then
    new.uploaded_at := now();
  end if;
  select new.uploaded_at + make_interval(days => s.evidence_retention_days)
    into new.purge_after from public.system_settings s where s.id = 1;
  return new;
end $$;

create trigger evidence_before_insert before insert on public.evidence_files
  for each row execute function public.evidence_before_insert();

create or replace function public.evidence_flag_duplicate()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare v_other uuid;
begin
  select e.run_id into v_other from public.evidence_files e
  where e.content_sha256 = new.content_sha256 and e.run_id <> new.run_id and e.purged_at is null
  limit 1;
  if v_other is not null then
    insert into public.run_flags (run_id, code, detail)
    values (new.run_id, 'duplicate_image', jsonb_build_object('other_run_id', v_other))
    on conflict (run_id, code) do nothing;
  end if;
  return null;
end $$;

create trigger evidence_flag_duplicate after insert on public.evidence_files
  for each row execute function public.evidence_flag_duplicate();

-- -----------------------------------------------------------------------------
-- ตารางคะแนน
-- -----------------------------------------------------------------------------

-- ส่งสัญญาณ "มีข้อมูลใหม่" ผ่าน Supabase Realtime ถ้ามี (ไม่มีก็ข้าม — client ใช้ polling)
create or replace function public.notify_leaderboard_changed(p_season_id uuid, p_version bigint)
returns void language plpgsql security definer
set search_path = ''
as $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    execute 'select realtime.send($1, $2, $3, false)'
      using jsonb_build_object('season_id', p_season_id, 'version', p_version),
            'leaderboard_changed', 'season:' || p_season_id || ':leaderboard';
  end if;
exception when others then
  -- real-time เป็นชั้นเสริม ห้ามทำให้การอนุมัติล้มเหลว
  raise warning 'notify_leaderboard_changed failed: %', sqlerrm;
end $$;

-- คำนวณตารางคะแนนทั้งฤดูกาลใหม่จาก ledger
--   อันดับ: คะแนนมาก→น้อย, ถึงคะแนนนั้นก่อน (reached_at), user_id
--   reached_at = เวลาล่าสุดของ "แหล่งคะแนน" ที่ยังมีผล (รายการวิ่ง = submitted_at, ปรับมือ = เวลาที่ปรับ)
create or replace function public.refresh_leaderboard(p_season_id uuid)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare v_version bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('leaderboard:' || p_season_id, 0));

  if to_regclass('pg_temp._lb_new') is null then
    create temp table _lb_new (
      user_id uuid primary key, total_points numeric, total_distance_km numeric,
      approved_run_count int, reached_at timestamptz, rank int) on commit drop;
  else
    truncate _lb_new;
  end if;

  insert into _lb_new
  with sources as (
    select l.user_id, coalesce(l.run_id::text, 'adj:' || l.id) as source_key,
           sum(l.points) as points, sum(l.distance_km) as distance_km, min(l.effective_at) as effective_at
    from public.point_ledger l
    join public.profiles p on p.id = l.user_id and p.anonymized_at is null
    where l.season_id = p_season_id
    group by l.user_id, coalesce(l.run_id::text, 'adj:' || l.id)
  ), totals as (
    select s.user_id, sum(s.points) as total_points, sum(s.distance_km) as total_distance_km,
           max(s.effective_at) filter (where s.points <> 0) as reached_at
    from sources s group by s.user_id
  )
  select t.user_id, t.total_points, t.total_distance_km,
         (select count(*) from public.runs r
          where r.season_id = p_season_id and r.user_id = t.user_id and r.status = 'approved')::int,
         t.reached_at,
         row_number() over (order by t.total_points desc, t.reached_at asc, t.user_id asc)::int
  from totals t
  where t.total_points > 0;

  delete from public.leaderboard_entries e
  where e.season_id = p_season_id and not exists (select 1 from _lb_new n where n.user_id = e.user_id);

  insert into public.leaderboard_entries as e
    (season_id, user_id, total_points, total_distance_km, approved_run_count, reached_at, rank, previous_rank, updated_at)
  select p_season_id, n.user_id, n.total_points, n.total_distance_km, n.approved_run_count, n.reached_at, n.rank, null, now()
  from _lb_new n
  on conflict (season_id, user_id) do update set
    total_points       = excluded.total_points,
    total_distance_km  = excluded.total_distance_km,
    approved_run_count = excluded.approved_run_count,
    reached_at         = excluded.reached_at,
    rank               = excluded.rank,
    -- previous_rank เปลี่ยนเฉพาะเมื่ออันดับเปลี่ยน เพื่อให้ ▲/▼ คงอยู่จนกว่าจะเปลี่ยนอีกครั้ง
    previous_rank      = case when e.rank <> excluded.rank then e.rank else e.previous_rank end,
    updated_at         = case when (e.total_points, e.rank) is distinct from (excluded.total_points, excluded.rank)
                              then now() else e.updated_at end;

  update public.seasons s set leaderboard_version = s.leaderboard_version + 1
  where s.id = p_season_id
  returning s.leaderboard_version into v_version;

  perform public.notify_leaderboard_changed(p_season_id, v_version);
  return v_version;
end $$;

-- -----------------------------------------------------------------------------
-- RPC: พนักงาน
-- -----------------------------------------------------------------------------

-- บันทึกการวิ่ง + รูปหลักฐานใน transaction เดียว
-- p_evidence: [{ "object_key", "content_sha256", "mime_type", "byte_size" }]
create or replace function public.submit_run(
  p_run_date date, p_distance_km numeric, p_duration_seconds int, p_note text, p_evidence jsonb)
returns public.runs language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.current_profile_id();
  v_run  public.runs;
  v_item jsonb;
begin
  if v_user is null then perform public.raise_app_error('NOT_AUTHENTICATED'); end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then
    perform public.raise_app_error('EVIDENCE_REQUIRED');
  end if;

  insert into public.runs (user_id, season_id, rule_id, run_date, distance_km, duration_seconds, note)
  values (v_user, null, null, p_run_date, p_distance_km, p_duration_seconds, nullif(btrim(p_note), ''))
  returning * into v_run;

  for v_item in select * from jsonb_array_elements(p_evidence) loop
    -- object key ต้องอยู่ใต้โฟลเดอร์ของผู้ใช้เอง (server เป็นคนออก presigned URL ตาม prefix นี้)
    if not coalesce((v_item ->> 'object_key') like ('evidence/' || v_user || '/%'), false) then
      perform public.raise_app_error('INVALID_EVIDENCE_KEY');
    end if;
    insert into public.evidence_files (run_id, object_key, content_sha256, mime_type, byte_size)
    values (v_run.id, v_item ->> 'object_key', v_item ->> 'content_sha256',
            v_item ->> 'mime_type', (v_item ->> 'byte_size')::int);
  end loop;

  return v_run;
end $$;

create or replace function public.cancel_run(p_run_id uuid)
returns void language plpgsql security definer
set search_path = ''
as $$
begin
  update public.runs set status = 'cancelled'
  where id = p_run_id and user_id = public.current_profile_id() and status = 'pending';
  if not found then perform public.raise_app_error('RUN_NOT_CANCELLABLE'); end if;
end $$;

create or replace function public.update_my_profile(p_display_name text, p_locale text)
returns void language plpgsql security definer
set search_path = ''
as $$
begin
  update public.profiles
  set display_name = coalesce(nullif(btrim(p_display_name), ''), display_name),
      locale = coalesce(p_locale, locale)
  where id = public.current_profile_id();
end $$;

create or replace function public.accept_privacy_notice(p_version text)
returns void language plpgsql security definer
set search_path = ''
as $$
begin
  if p_version is distinct from (select s.current_privacy_notice_version from public.system_settings s where s.id = 1) then
    perform public.raise_app_error('PRIVACY_NOTICE_OUTDATED');
  end if;
  update public.profiles set privacy_notice_version = p_version, consented_at = now()
  where id = public.current_profile_id();
end $$;

-- server เรียกหลังผู้ใช้เปลี่ยนรหัสผ่านสำเร็จ (ด้วย JWT ของผู้ใช้)
create or replace function public.mark_password_changed()
returns void language sql security definer
set search_path = ''
as $$ update public.profiles set must_change_password = false where id = public.current_profile_id() $$;

create or replace function public.request_data_deletion(p_note text)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare v_id uuid; v_user uuid := public.current_profile_id();
begin
  if v_user is null then perform public.raise_app_error('NOT_AUTHENTICATED'); end if;
  insert into public.data_deletion_requests (user_id, requested_by, note)
  values (v_user, v_user, p_note) returning id into v_id;
  return v_id;
exception when unique_violation then
  perform public.raise_app_error('DELETION_ALREADY_REQUESTED');
  return null;
end $$;

-- -----------------------------------------------------------------------------
-- RPC: ผู้ตรวจ
-- -----------------------------------------------------------------------------
create or replace function public._review_run(p_run_id uuid, p_decision public.review_decision, p_reason text)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_run   public.runs;
  v_rule  public.season_rules;
  v_net   numeric;
  v_dist  numeric;
begin
  if not public.is_reviewer() then perform public.raise_app_error('FORBIDDEN'); end if;

  select r.* into v_run from public.runs r where r.id = p_run_id for update;
  if v_run.id is null then perform public.raise_app_error('RUN_NOT_FOUND'); end if;
  if v_run.user_id = v_actor then perform public.raise_app_error('CANNOT_REVIEW_OWN_RUN'); end if;
  if (select s.status from public.seasons s where s.id = v_run.season_id) <> 'active' then
    perform public.raise_app_error('SEASON_NOT_ACTIVE');
  end if;
  if p_decision in ('approved', 'rejected') and v_run.status <> 'pending' then
    perform public.raise_app_error('RUN_NOT_PENDING');
  end if;
  if p_decision = 'revoked' and v_run.status <> 'approved' then
    perform public.raise_app_error('RUN_NOT_APPROVED');
  end if;

  perform public.set_audit_reason(p_reason);
  insert into public.run_reviews (run_id, reviewer_id, decision, reason)
  values (p_run_id, v_actor, p_decision, nullif(btrim(p_reason), ''));

  update public.runs set status = p_decision::text::public.run_status where id = p_run_id;

  if p_decision = 'approved' then
    v_rule := public.current_rule(v_run.season_id);
    insert into public.point_ledger
      (season_id, user_id, run_id, rule_id, entry_type, points, distance_km, effective_at, reason, created_by)
    values (v_run.season_id, v_run.user_id, v_run.id, v_rule.id, 'run_approved',
            public.compute_points(v_run.distance_km, v_rule.points_per_km), v_run.distance_km,
            v_run.submitted_at, coalesce(nullif(btrim(p_reason), ''), 'อนุมัติการวิ่ง'), v_actor);
  elsif p_decision = 'revoked' then
    select sum(l.points), sum(l.distance_km) into v_net, v_dist
    from public.point_ledger l where l.run_id = v_run.id;
    insert into public.point_ledger
      (season_id, user_id, run_id, rule_id, entry_type, points, distance_km, effective_at, reason, created_by)
    values (v_run.season_id, v_run.user_id, v_run.id, null, 'run_revoked',
            -v_net, -v_dist, v_run.submitted_at, p_reason, v_actor);
  end if;

  return v_run.season_id;
end $$;

create or replace function public.review_run(p_run_id uuid, p_decision public.review_decision, p_reason text default null)
returns void language plpgsql security definer
set search_path = ''
as $$
declare v_season uuid;
begin
  v_season := public._review_run(p_run_id, p_decision, p_reason);
  if p_decision <> 'rejected' then
    perform public.refresh_leaderboard(v_season);
  end if;
end $$;

-- อนุมัติ/ปฏิเสธหลายรายการ: ทั้งหมดหรือไม่มีเลย (atomic) และคำนวณอันดับครั้งเดียว
create or replace function public.review_runs_bulk(p_run_ids uuid[], p_decision public.review_decision, p_reason text default null)
returns int language plpgsql security definer
set search_path = ''
as $$
declare v_id uuid; v_season uuid; v_seasons uuid[] := '{}'; v_n int := 0;
begin
  if p_decision = 'revoked' then perform public.raise_app_error('BULK_REVOKE_NOT_ALLOWED'); end if;
  if coalesce(array_length(p_run_ids, 1), 0) > 200 then perform public.raise_app_error('BULK_LIMIT_EXCEEDED'); end if;
  foreach v_id in array p_run_ids loop
    v_season := public._review_run(v_id, p_decision, p_reason);
    if not v_season = any (v_seasons) then v_seasons := v_seasons || v_season; end if;
    v_n := v_n + 1;
  end loop;
  if p_decision = 'approved' then
    foreach v_season in array v_seasons loop perform public.refresh_leaderboard(v_season); end loop;
  end if;
  return v_n;
end $$;

-- -----------------------------------------------------------------------------
-- RPC: แอดมิน
-- -----------------------------------------------------------------------------
create or replace function public.require_admin()
returns void language plpgsql stable
set search_path = ''
as $$
begin
  if not public.has_role('admin') then perform public.raise_app_error('FORBIDDEN'); end if;
end $$;

create or replace function public.adjust_points(p_season_id uuid, p_user_id uuid, p_points numeric, p_reason text)
returns void language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  if (select s.status from public.seasons s where s.id = p_season_id) <> 'active' then
    perform public.raise_app_error('SEASON_NOT_ACTIVE');
  end if;
  insert into public.point_ledger (season_id, user_id, entry_type, points, effective_at, reason, created_by)
  values (p_season_id, p_user_id, 'manual_adjustment', p_points, now(), p_reason, public.current_profile_id());
  perform public.refresh_leaderboard(p_season_id);
end $$;

-- คำนวณคะแนนย้อนหลังทั้งฤดูกาลด้วยกติกาปัจจุบัน: เขียนเฉพาะส่วนต่างเป็น rule_recalc
create or replace function public.recalculate_season(p_season_id uuid, p_reason text)
returns int language plpgsql security definer
set search_path = ''
as $$
declare v_rule public.season_rules; v_n int;
begin
  perform public.require_admin();
  if (select s.status from public.seasons s where s.id = p_season_id) <> 'active' then
    perform public.raise_app_error('SEASON_NOT_ACTIVE');
  end if;
  v_rule := public.current_rule(p_season_id);

  insert into public.point_ledger
    (season_id, user_id, run_id, rule_id, entry_type, points, distance_km, effective_at, reason, created_by)
  select p_season_id, r.user_id, r.id, v_rule.id, 'rule_recalc',
         public.compute_points(r.distance_km, v_rule.points_per_km) - cur.points, 0,
         r.submitted_at, p_reason, public.current_profile_id()
  from public.runs r
  join lateral (select sum(l.points) as points from public.point_ledger l where l.run_id = r.id) cur on true
  where r.season_id = p_season_id and r.status = 'approved'
    and public.compute_points(r.distance_km, v_rule.points_per_km) <> cur.points;
  get diagnostics v_n = row_count;

  perform public.refresh_leaderboard(p_season_id);
  return v_n;
end $$;

create or replace function public.close_season(p_season_id uuid, p_force boolean default false, p_reason text default null)
returns void language plpgsql security definer
set search_path = ''
as $$
declare v_pending int; v_id uuid;
begin
  perform public.require_admin();
  select count(*) into v_pending from public.runs r where r.season_id = p_season_id and r.status = 'pending';
  if v_pending > 0 and not p_force then
    perform public.raise_app_error('SEASON_HAS_PENDING_RUNS', jsonb_build_object('pending', v_pending));
  end if;
  for v_id in select r.id from public.runs r where r.season_id = p_season_id and r.status = 'pending' loop
    perform public._review_run(v_id, 'rejected', coalesce(p_reason, 'ปิดฤดูกาลก่อนได้รับการตรวจ'));
  end loop;
  perform public.refresh_leaderboard(p_season_id);
  perform public.set_audit_reason(p_reason);
  perform set_config('app.closing_season', 'on', true);
  update public.seasons set status = 'closed' where id = p_season_id and status = 'active';
  perform set_config('app.closing_season', 'off', true);
  if not found then perform public.raise_app_error('SEASON_NOT_ACTIVE'); end if;
end $$;

create or replace function public.copy_participants(p_from_season uuid, p_to_season uuid)
returns int language plpgsql security definer
set search_path = ''
as $$
declare v_n int;
begin
  perform public.require_admin();
  insert into public.season_participants (season_id, user_id, added_by)
  select p_to_season, sp.user_id, public.current_profile_id()
  from public.season_participants sp
  join public.profiles p on p.id = sp.user_id and p.deleted_at is null and p.anonymized_at is null
  where sp.season_id = p_from_season and sp.removed_at is null
  on conflict (season_id, user_id) do update set removed_at = null
    where public.season_participants.removed_at is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- service_role เท่านั้น: สร้างโปรไฟล์หลังสร้างบัญชีใน Supabase Auth (Admin API)
create or replace function public.admin_provision_user(
  p_actor_id uuid, p_auth_user_id uuid, p_employee_code text, p_display_name text,
  p_department_id uuid, p_roles public.app_role[] default '{runner}')
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare v_id uuid; v_role public.app_role;
begin
  if not exists (select 1 from public.user_roles r where r.user_id = p_actor_id and r.role = 'admin') then
    perform public.raise_app_error('FORBIDDEN');
  end if;
  perform set_config('app.actor_id', p_actor_id::text, true);
  insert into public.profiles (auth_user_id, employee_code, display_name, department_id)
  values (p_auth_user_id, p_employee_code, p_display_name, p_department_id)
  returning id into v_id;
  foreach v_role in array p_roles loop
    insert into public.user_roles (user_id, role, granted_by) values (v_id, v_role, p_actor_id);
  end loop;
  return v_id;
end $$;

-- PDPA: ทำให้เป็นนิรนาม (การลบบัญชี auth.users ทำในฟังก์ชันนี้ด้วย)
create or replace function public.anonymize_user(p_user_id uuid, p_request_id uuid default null)
returns void language plpgsql security definer
set search_path = ''
as $$
declare v_auth uuid; v_season uuid;
begin
  perform public.require_admin();
  if p_user_id = public.current_profile_id() then perform public.raise_app_error('CANNOT_ANONYMIZE_SELF'); end if;
  perform public.set_audit_reason('PDPA data deletion request');

  select p.auth_user_id into v_auth from public.profiles p where p.id = p_user_id and p.anonymized_at is null for update;
  if not found then perform public.raise_app_error('USER_NOT_FOUND'); end if;

  update public.evidence_files e set purge_after = now()
  from public.runs r where r.id = e.run_id and r.user_id = p_user_id and e.purged_at is null;

  update public.runs set note = null where user_id = p_user_id and note is not null;

  update public.profiles set
    employee_code = null,
    display_name = 'ผู้ใช้ที่ลบแล้ว',
    department_id = null,
    is_active = false,
    anonymized_at = now(),
    deleted_at = now()
  where id = p_user_id;

  delete from public.user_roles where user_id = p_user_id;
  update public.season_participants set removed_at = now() where user_id = p_user_id and removed_at is null;
  if v_auth is not null then delete from auth.users where id = v_auth; end if;

  for v_season in select distinct e.season_id from public.leaderboard_entries e where e.user_id = p_user_id loop
    perform public.refresh_leaderboard(v_season);
  end loop;

  if p_request_id is not null then
    update public.data_deletion_requests
    set status = 'completed', processed_by = public.current_profile_id(), processed_at = now()
    where id = p_request_id and user_id = p_user_id and status = 'pending';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Jobs (service_role — เรียกจาก Cloudflare Cron Trigger)
-- -----------------------------------------------------------------------------
create or replace function public.evidence_due_for_purge(p_limit int default 500)
returns table (id uuid, storage_provider text, object_key text)
language sql stable security definer
set search_path = ''
as $$
  select e.id, e.storage_provider, e.object_key from public.evidence_files e
  where e.purged_at is null and e.purge_after <= now()
  order by e.purge_after limit least(p_limit, 1000)
$$;

create or replace function public.mark_evidence_purged(p_ids uuid[])
returns int language plpgsql security definer
set search_path = ''
as $$
declare v_n int;
begin
  update public.evidence_files set purged_at = now() where id = any (p_ids) and purged_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.purge_expired_audit_logs()
returns int language plpgsql security definer
set search_path = ''
as $$
declare v_n int;
begin
  perform set_config('app.audit_purge', 'on', true);
  delete from public.audit_logs a
  using public.system_settings s
  where s.id = 1 and a.created_at < now() - make_interval(days => s.audit_retention_days);
  get diagnostics v_n = row_count;
  delete from public.login_attempts where created_at < now() - interval '30 days';
  perform set_config('app.audit_purge', 'off', true);
  return v_n;
end $$;

-- ล็อกอิน: server ตรวจ Turnstile แล้วเรียก 2 ฟังก์ชันนี้ด้วย service_role
create or replace function public.is_login_locked(p_username_hash text)
returns boolean language sql stable security definer
set search_path = ''
as $$
  with s as (select login_max_failures, login_lock_minutes from public.system_settings where id = 1),
  recent as (
    select a.succeeded from public.login_attempts a, s
    where a.username_hash = p_username_hash
      and a.created_at > now() - make_interval(mins => s.login_lock_minutes)
    order by a.created_at desc limit (select login_max_failures from s))
  select count(*) filter (where not succeeded) >= (select login_max_failures from s)
  from recent
$$;

create or replace function public.record_login_attempt(p_username_hash text, p_ip_hash text, p_succeeded boolean)
returns void language sql security definer
set search_path = ''
as $$
  insert into public.login_attempts (username_hash, ip_hash, succeeded) values (p_username_hash, p_ip_hash, p_succeeded)
$$;

-- -----------------------------------------------------------------------------
-- Views (อ่านอย่างเดียว ไม่เปิดเผย employee_code)
-- -----------------------------------------------------------------------------
create view public.public_profiles with (security_barrier) as
  select p.id, p.display_name, p.department_id
  from public.profiles p
  where p.deleted_at is null and p.anonymized_at is null;

create view public.leaderboard with (security_barrier) as
  select e.season_id, e.user_id, p.display_name, d.code as department_code, d.name_th as department_name_th,
         d.name_en as department_name_en, e.total_points, e.total_distance_km, e.approved_run_count,
         e.reached_at, e.rank, e.previous_rank, e.updated_at
  from public.leaderboard_entries e
  join public.profiles p on p.id = e.user_id and p.anonymized_at is null
  left join public.departments d on d.id = p.department_id and d.deleted_at is null;

create view public.activity_feed with (security_barrier) as
  select l.id, l.season_id, l.user_id, p.display_name, l.distance_km, l.points, l.created_at
  from public.point_ledger l
  join public.runs r on r.id = l.run_id and r.status = 'approved'
  join public.profiles p on p.id = l.user_id and p.anonymized_at is null
  where l.entry_type = 'run_approved';
