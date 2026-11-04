-- ไฟล์นี้สร้างจาก scripts/make-demo-sql.sh — ห้ามแก้ตรงนี้ ให้แก้ที่ supabase/migrations และ supabase/seed.sql
-- ใช้กับโปรเจกต์สาธิตเท่านั้น: สร้างตาราง + ข้อมูลตัวอย่าง 10 คน 2 ฤดูกาล

-- ============================== supabase/migrations/20261021000001_schema.sql
-- =============================================================================
-- workingRun — schema (tables, enums, constraints, indexes)
-- ทุก timestamp เป็น timestamptz (เก็บ UTC) · วันที่วิ่งเป็น date ตามเวลา Asia/Bangkok
-- =============================================================================

create extension if not exists citext with schema extensions;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.app_role          as enum ('runner', 'approver', 'admin');
create type public.season_status     as enum ('draft', 'active', 'closed');
create type public.run_status        as enum ('pending', 'approved', 'rejected', 'cancelled', 'revoked');
create type public.review_decision   as enum ('approved', 'rejected', 'revoked');
create type public.flag_code         as enum ('pace_too_fast', 'pace_too_slow', 'distance_high',
                                              'daily_total_high', 'duplicate_entry', 'duplicate_image');
create type public.ledger_entry_type as enum ('run_approved', 'run_revoked', 'manual_adjustment', 'rule_recalc');
create type public.deletion_status   as enum ('pending', 'completed', 'rejected');

-- -----------------------------------------------------------------------------
-- องค์กรและผู้ใช้
-- -----------------------------------------------------------------------------
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  code        text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name_th     text not null check (length(name_th) between 1 and 100),
  name_en     text not null check (length(name_en) between 1 and 100),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index departments_code_uk on public.departments (code) where deleted_at is null;

create table public.profiles (
  id                     uuid primary key default gen_random_uuid(),
  auth_user_id           uuid unique references auth.users (id) on delete set null,
  employee_code          extensions.citext not null check (employee_code ~ '^[A-Za-z0-9._-]{3,32}$'),
  display_name           text not null check (length(btrim(display_name)) between 1 and 60),
  department_id          uuid references public.departments (id),
  locale                 text not null default 'th' check (locale in ('th', 'en')),
  must_change_password   boolean not null default true,
  is_active              boolean not null default true,
  privacy_notice_version text,
  consented_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  constraint profiles_consent_pair  check ((privacy_notice_version is null) = (consented_at is null))
);
create unique index profiles_employee_code_uk on public.profiles (employee_code) where deleted_at is null;
create index profiles_department_idx on public.profiles (department_id) where deleted_at is null;

create table public.user_roles (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        public.app_role not null,
  granted_by  uuid references public.profiles (id),
  granted_at  timestamptz not null default now(),
  primary key (user_id, role)
);

-- -----------------------------------------------------------------------------
-- ฤดูกาลและกติกา
-- -----------------------------------------------------------------------------
create table public.seasons (
  id                   uuid primary key default gen_random_uuid(),
  name_th              text not null check (length(name_th) between 1 and 100),
  name_en              text not null check (length(name_en) between 1 and 100),
  start_date           date not null,
  end_date             date not null,
  status               public.season_status not null default 'draft',
  -- จำนวนวันหลัง end_date ที่ผู้ตรวจยังเคลียร์คิวได้ก่อนปิดอัตโนมัติ (เฟส 2: cron)
  review_grace_days    smallint not null default 3 check (review_grace_days between 0 and 30),
  leaderboard_version  bigint not null default 0,
  closed_at            timestamptz,
  closed_by            uuid references public.profiles (id),
  created_by           uuid references public.profiles (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  constraint seasons_date_order check (end_date >= start_date),
  constraint seasons_closed_pair check ((status = 'closed') = (closed_at is not null)),
  constraint seasons_no_overlap exclude using gist (daterange(start_date, end_date, '[]') with &&)
    where (deleted_at is null)
);
create unique index seasons_one_active_uk on public.seasons ((true)) where status = 'active' and deleted_at is null;

create table public.season_rules (
  id                        uuid primary key default gen_random_uuid(),
  season_id                 uuid not null references public.seasons (id),
  version                   int not null check (version > 0),
  points_per_km             numeric(8, 2) not null default 10 check (points_per_km > 0),
  min_distance_km           numeric(6, 2) not null default 0.1 check (min_distance_km >= 0.01),
  max_backdate_days         smallint not null default 7 check (max_backdate_days between 0 and 90),
  max_evidence_files        smallint not null default 3 check (max_evidence_files between 1 and 10),
  -- เกณฑ์ติดธง: NULL = ปิดกฎนั้น
  flag_min_pace_sec_per_km  int default 180 check (flag_min_pace_sec_per_km > 0),
  flag_max_pace_sec_per_km  int default 1200 check (flag_max_pace_sec_per_km > 0),
  flag_max_distance_km      numeric(6, 2) default 42.2 check (flag_max_distance_km > 0),
  flag_max_daily_km         numeric(6, 2) default 50 check (flag_max_daily_km > 0),
  change_reason             text not null default 'ค่าเริ่มต้น' check (length(btrim(change_reason)) > 0),
  created_by                uuid references public.profiles (id),
  created_at                timestamptz not null default now(),
  unique (season_id, version),
  constraint season_rules_pace_order check (
    flag_min_pace_sec_per_km is null or flag_max_pace_sec_per_km is null
    or flag_min_pace_sec_per_km < flag_max_pace_sec_per_km)
);

create table public.season_participants (
  season_id   uuid not null references public.seasons (id),
  user_id     uuid not null references public.profiles (id),
  added_by    uuid references public.profiles (id),
  added_at    timestamptz not null default now(),
  removed_at  timestamptz,
  primary key (season_id, user_id)
);
create index season_participants_user_idx on public.season_participants (user_id) where removed_at is null;

-- -----------------------------------------------------------------------------
-- การวิ่ง
-- -----------------------------------------------------------------------------
create table public.runs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id),
  season_id         uuid not null references public.seasons (id),
  rule_id           uuid not null references public.season_rules (id),
  run_date          date not null,
  distance_km       numeric(6, 2) not null check (distance_km > 0 and distance_km <= 500),
  duration_seconds  int not null check (duration_seconds between 1 and 172800),
  pace_sec_per_km   int generated always as (round(duration_seconds / distance_km)::int) stored,
  note              text check (length(note) <= 280),
  status            public.run_status not null default 'pending',
  -- Idempotency-Key จากหน้าเว็บ กันกดส่งซ้ำเมื่อเน็ตมือถือหลุด
  client_request_id uuid,
  submitted_at      timestamptz not null default now(),
  decided_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint runs_decided_pair check ((status in ('pending', 'cancelled')) = (decided_at is null))
);
create index runs_user_history_idx on public.runs (user_id, season_id, run_date desc);
create index runs_pending_queue_idx on public.runs (season_id, submitted_at) where status = 'pending';
create index runs_user_day_idx on public.runs (user_id, run_date) where status in ('pending', 'approved');
create index runs_season_status_idx on public.runs (season_id, status);
create unique index runs_client_request_uk on public.runs (user_id, client_request_id) where client_request_id is not null;

create table public.run_flags (
  run_id      uuid not null references public.runs (id) on delete cascade,
  code        public.flag_code not null,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  primary key (run_id, code)
);
create index run_flags_code_idx on public.run_flags (code);

create table public.run_reviews (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references public.runs (id),
  reviewer_id  uuid not null references public.profiles (id),
  decision     public.review_decision not null,
  reason       text check (length(reason) <= 500),
  created_at   timestamptz not null default now(),
  constraint run_reviews_reason_required check (
    decision = 'approved' or length(btrim(coalesce(reason, ''))) > 0)
);
create index run_reviews_run_idx on public.run_reviews (run_id, created_at desc);
create index run_reviews_reviewer_idx on public.run_reviews (reviewer_id, created_at desc);

create table public.evidence_files (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references public.runs (id),
  storage_provider  text not null default 'r2' check (storage_provider in ('r2', 'supabase')),
  object_key        text not null unique check (length(object_key) between 1 and 512),
  content_sha256    text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  mime_type         text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  byte_size         int not null check (byte_size between 1 and 2097152),
  uploaded_at       timestamptz not null default now(),
  purge_after       timestamptz not null,
  purged_at         timestamptz
);
create index evidence_files_run_idx on public.evidence_files (run_id);
create index evidence_files_sha_idx on public.evidence_files (content_sha256) where purged_at is null;
create index evidence_files_purge_idx on public.evidence_files (purge_after) where purged_at is null;

-- -----------------------------------------------------------------------------
-- คะแนน
-- -----------------------------------------------------------------------------
create table public.point_ledger (
  id            bigint generated always as identity primary key,
  season_id     uuid not null references public.seasons (id),
  user_id       uuid not null references public.profiles (id),
  run_id        uuid references public.runs (id),
  rule_id       uuid references public.season_rules (id),
  entry_type    public.ledger_entry_type not null,
  points        numeric(10, 2) not null check (points <> 0),
  distance_km   numeric(8, 2) not null default 0,
  effective_at  timestamptz not null,
  reason        text not null check (length(btrim(reason)) between 1 and 500),
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  constraint point_ledger_run_link check (
    (entry_type = 'manual_adjustment') = (run_id is null)),
  constraint point_ledger_sign check (
    (entry_type = 'run_approved' and points > 0 and distance_km > 0)
    or (entry_type = 'run_revoked' and points < 0 and distance_km < 0)
    or (entry_type in ('manual_adjustment', 'rule_recalc') and distance_km = 0))
);
create unique index point_ledger_run_approved_uk on public.point_ledger (run_id) where entry_type = 'run_approved';
create unique index point_ledger_run_revoked_uk on public.point_ledger (run_id) where entry_type = 'run_revoked';
create index point_ledger_season_user_idx on public.point_ledger (season_id, user_id);
create index point_ledger_feed_idx on public.point_ledger (season_id, created_at desc);

create table public.leaderboard_entries (
  season_id           uuid not null references public.seasons (id),
  user_id             uuid not null references public.profiles (id),
  total_points        numeric(12, 2) not null,
  total_distance_km   numeric(10, 2) not null,
  approved_run_count  int not null check (approved_run_count >= 0),
  reached_at          timestamptz not null,
  rank                int not null check (rank > 0),
  previous_rank       int check (previous_rank > 0),
  updated_at          timestamptz not null default now(),
  primary key (season_id, user_id)
);
create index leaderboard_entries_rank_idx on public.leaderboard_entries (season_id, rank);

-- -----------------------------------------------------------------------------
-- ตรวจสอบ, PDPA, ระบบ
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id           bigint generated always as identity primary key,
  actor_id     uuid references public.profiles (id),
  action       text not null,
  entity_type  text not null,
  entity_id    text,
  before_data  jsonb,
  after_data   jsonb,
  reason       text,
  created_at   timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create index audit_logs_created_idx on public.audit_logs (created_at);

create table public.data_deletion_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id),
  requested_by  uuid references public.profiles (id),
  status        public.deletion_status not null default 'pending',
  note          text check (length(note) <= 500),
  processed_by  uuid references public.profiles (id),
  requested_at  timestamptz not null default now(),
  processed_at  timestamptz,
  constraint ddr_processed_pair check ((status = 'pending') = (processed_at is null))
);
create unique index ddr_one_pending_uk on public.data_deletion_requests (user_id) where status = 'pending';

create table public.system_settings (
  id                              smallint primary key default 1 check (id = 1),
  evidence_retention_days         smallint not null default 90 check (evidence_retention_days between 1 and 3650),
  audit_retention_days            smallint not null default 730 check (audit_retention_days between 30 and 3650),
  login_max_failures              smallint not null default 5 check (login_max_failures between 1 and 50),
  login_lock_minutes              smallint not null default 15 check (login_lock_minutes between 1 and 1440),
  current_privacy_notice_version  text not null default '2569-1',
  updated_at                      timestamptz not null default now(),
  updated_by                      uuid references public.profiles (id)
);
insert into public.system_settings (id) values (1);

create table public.login_attempts (
  id             bigint generated always as identity primary key,
  username_hash  text not null check (username_hash ~ '^[0-9a-f]{64}$'),
  ip_hash        text check (ip_hash ~ '^[0-9a-f]{64}$'),
  succeeded      boolean not null,
  created_at     timestamptz not null default now()
);
create index login_attempts_user_idx on public.login_attempts (username_hash, created_at desc);

-- ============================== supabase/migrations/20261021000002_functions.sql
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
  for each row execute function public.audit_trigger();
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
  for each row execute function public.audit_trigger();
create trigger system_settings_audit after update on public.system_settings
  for each row execute function public.audit_trigger();
create trigger ddr_audit after insert or update on public.data_deletion_requests
  for each row execute function public.audit_trigger();

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
    and (s.status = 'active' or v_bypass)
  for share;
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
-- p_client_request_id: ส่งค่าเดิมซ้ำ → ได้รายการเดิมกลับไป (ไม่สร้างซ้ำ)
create or replace function public.submit_run(
  p_run_date date, p_distance_km numeric, p_duration_seconds int, p_note text, p_evidence jsonb,
  p_client_request_id uuid default null)
returns public.runs language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.current_profile_id();
  v_run  public.runs;
  v_item jsonb;
begin
  if v_user is null then perform public.raise_app_error('NOT_AUTHENTICATED'); end if;
  if p_client_request_id is not null then
    select r.* into v_run from public.runs r
    where r.user_id = v_user and r.client_request_id = p_client_request_id;
    if v_run.id is not null then return v_run; end if;
  end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then
    perform public.raise_app_error('EVIDENCE_REQUIRED');
  end if;

  insert into public.runs (user_id, season_id, rule_id, run_date, distance_km, duration_seconds, note, client_request_id)
  values (v_user, null, null, p_run_date, p_distance_km, p_duration_seconds, nullif(btrim(p_note), ''), p_client_request_id)
  returning * into v_run;

  for v_item in select * from jsonb_array_elements(p_evidence) loop
    -- object key ต้องอยู่ใต้โฟลเดอร์ของผู้ใช้เอง (server อัปโหลดไฟล์ไว้ตาม prefix นี้)
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

-- ปิดได้เมื่อตรวจครบทุกรายการแล้วเท่านั้น (ไม่มีการบังคับปิด)
create or replace function public.close_season(p_season_id uuid, p_reason text default null)
returns void language plpgsql security definer
set search_path = ''
as $$
declare v_pending int;
begin
  perform public.require_admin();
  -- ล็อกฤดูกาลก่อนนับ กันรายการใหม่เข้ามาระหว่างปิด
  perform 1 from public.seasons s where s.id = p_season_id for update;
  select count(*) into v_pending from public.runs r where r.season_id = p_season_id and r.status = 'pending';
  if v_pending > 0 then
    perform public.raise_app_error('SEASON_HAS_PENDING_RUNS', jsonb_build_object('pending', v_pending));
  end if;
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
  join public.profiles p on p.id = sp.user_id and p.deleted_at is null and p.is_active
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

-- คำขอลบข้อมูล: ปิดบัญชี + ลบรูปหลักฐานทันที
-- ชื่อ รหัสพนักงาน คะแนน และอันดับย้อนหลัง "เก็บไว้" ตามนโยบายองค์กร (ระบบภายใน ลบทั้งระบบเมื่อจบโครงการ)
create or replace function public.close_user_account(p_user_id uuid, p_request_id uuid default null)
returns void language plpgsql security definer
set search_path = ''
as $$
declare v_auth uuid;
begin
  perform public.require_admin();
  if p_user_id = public.current_profile_id() then perform public.raise_app_error('CANNOT_CLOSE_OWN_ACCOUNT'); end if;
  perform public.set_audit_reason('data deletion request');

  select p.auth_user_id into v_auth from public.profiles p
  where p.id = p_user_id and p.is_active for update;
  if not found then perform public.raise_app_error('USER_NOT_FOUND'); end if;

  update public.evidence_files e set purge_after = now()
  from public.runs r where r.id = e.run_id and r.user_id = p_user_id and e.purged_at is null;

  update public.runs set status = 'cancelled' where user_id = p_user_id and status = 'pending';

  update public.profiles set is_active = false where id = p_user_id;
  delete from public.user_roles where user_id = p_user_id;
  if v_auth is not null then delete from auth.users where id = v_auth; end if;

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
  where p.deleted_at is null;

create view public.leaderboard with (security_barrier) as
  select e.season_id, e.user_id, p.display_name, d.code as department_code, d.name_th as department_name_th,
         d.name_en as department_name_en, e.total_points, e.total_distance_km, e.approved_run_count,
         e.reached_at, e.rank, e.previous_rank, e.updated_at
  from public.leaderboard_entries e
  join public.profiles p on p.id = e.user_id
  left join public.departments d on d.id = p.department_id and d.deleted_at is null;

-- รายชื่อผู้มีสิทธิ์เล่น (ชื่อที่แสดงเท่านั้น) — ใช้แสดงผู้ที่ยังไม่มีคะแนนท้ายตาราง
create view public.season_roster with (security_barrier) as
  select sp.season_id, p.id as user_id, p.display_name
  from public.season_participants sp
  join public.profiles p on p.id = sp.user_id and p.deleted_at is null
  where sp.removed_at is null;

create view public.activity_feed with (security_barrier) as
  select l.id, l.season_id, l.user_id, p.display_name, l.distance_km, l.points, l.created_at
  from public.point_ledger l
  join public.runs r on r.id = l.run_id and r.status = 'approved'
  join public.profiles p on p.id = l.user_id
  where l.entry_type = 'run_approved';

-- ============================== supabase/migrations/20261021000003_rls.sql
-- =============================================================================
-- workingRun — Row Level Security & grants
-- หลักการ: client อ่านผ่าน RLS / view, เขียนข้อมูลสำคัญผ่าน RPC (SECURITY DEFINER) เท่านั้น
-- =============================================================================

-- ปิดสิทธิ์ทั้งหมดก่อน แล้วเปิดทีละอย่าง
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

alter table public.departments            enable row level security;
alter table public.profiles               enable row level security;
alter table public.user_roles             enable row level security;
alter table public.seasons                enable row level security;
alter table public.season_rules           enable row level security;
alter table public.season_participants    enable row level security;
alter table public.runs                   enable row level security;
alter table public.run_flags              enable row level security;
alter table public.run_reviews            enable row level security;
alter table public.evidence_files         enable row level security;
alter table public.point_ledger           enable row level security;
alter table public.leaderboard_entries    enable row level security;
alter table public.audit_logs             enable row level security;
alter table public.data_deletion_requests enable row level security;
alter table public.system_settings        enable row level security;
alter table public.login_attempts         enable row level security;

-- -----------------------------------------------------------------------------
-- อ่าน
-- -----------------------------------------------------------------------------
create policy departments_read on public.departments for select to authenticated
  using (deleted_at is null or public.has_role('admin'));

-- ผู้ตรวจต้องเห็นชื่อและรหัสพนักงานของเจ้าของรายการในคิว
create policy profiles_read on public.profiles for select to authenticated
  using (id = public.current_profile_id() or public.is_reviewer());

create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = public.current_profile_id() or public.has_role('admin'));

create policy seasons_read on public.seasons for select to authenticated
  using (deleted_at is null or public.has_role('admin'));

create policy season_rules_read on public.season_rules for select to authenticated using (true);

create policy season_participants_read on public.season_participants for select to authenticated
  using (user_id = public.current_profile_id() or public.is_reviewer());

create policy runs_read on public.runs for select to authenticated
  using (user_id = public.current_profile_id() or public.is_reviewer());

-- พนักงานเห็นธงของรายการตัวเองได้ (กิจกรรมเพื่อความสนุก ไม่ต้องซ่อนเกณฑ์)
create policy run_flags_read on public.run_flags for select to authenticated
  using (public.is_reviewer()
         or exists (select 1 from public.runs r where r.id = run_id and r.user_id = public.current_profile_id()));

create policy run_reviews_read on public.run_reviews for select to authenticated
  using (public.is_reviewer()
         or exists (select 1 from public.runs r where r.id = run_id and r.user_id = public.current_profile_id()));

create policy evidence_files_read on public.evidence_files for select to authenticated
  using (public.is_reviewer()
         or exists (select 1 from public.runs r where r.id = run_id and r.user_id = public.current_profile_id()));

create policy point_ledger_read on public.point_ledger for select to authenticated
  using (user_id = public.current_profile_id() or public.has_role('admin'));

create policy leaderboard_entries_read on public.leaderboard_entries for select to authenticated using (true);

create policy audit_logs_read on public.audit_logs for select to authenticated
  using (public.has_role('admin'));

create policy ddr_read on public.data_deletion_requests for select to authenticated
  using (user_id = public.current_profile_id() or public.has_role('admin'));

create policy system_settings_read on public.system_settings for select to authenticated using (true);

-- login_attempts: ไม่มี policy = ไม่มีใครอ่านได้นอกจาก service_role

-- -----------------------------------------------------------------------------
-- เขียน (เฉพาะแอดมิน สำหรับข้อมูลตั้งค่า) — คะแนน/การวิ่ง/รีวิว ผ่าน RPC เท่านั้น
-- -----------------------------------------------------------------------------
create policy departments_admin_insert on public.departments for insert to authenticated
  with check (public.has_role('admin'));
create policy departments_admin_update on public.departments for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy user_roles_admin_insert on public.user_roles for insert to authenticated
  with check (public.has_role('admin'));
-- ห้ามแอดมินถอดสิทธิ์ admin ของตัวเอง (กันระบบไม่มีแอดมิน)
create policy user_roles_admin_delete on public.user_roles for delete to authenticated
  using (public.has_role('admin') and not (user_id = public.current_profile_id() and role = 'admin'));

create policy seasons_admin_insert on public.seasons for insert to authenticated
  with check (public.has_role('admin'));
create policy seasons_admin_update on public.seasons for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy season_rules_admin_insert on public.season_rules for insert to authenticated
  with check (public.has_role('admin'));

create policy season_participants_admin_insert on public.season_participants for insert to authenticated
  with check (public.has_role('admin'));
create policy season_participants_admin_update on public.season_participants for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy ddr_admin_update on public.data_deletion_requests for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy system_settings_admin_update on public.system_settings for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- -----------------------------------------------------------------------------
-- Grants (ระดับคอลัมน์สำหรับ update เพื่อจำกัดสิ่งที่แก้ได้)
-- -----------------------------------------------------------------------------
grant select on all tables in schema public to authenticated;
revoke select on public.login_attempts from authenticated;

grant insert (code, name_th, name_en) on public.departments to authenticated;
grant update (code, name_th, name_en, deleted_at) on public.departments to authenticated;
grant update (display_name, department_id, is_active, must_change_password, deleted_at) on public.profiles to authenticated;
grant insert (user_id, role, granted_by) on public.user_roles to authenticated;
grant delete on public.user_roles to authenticated;
grant insert (name_th, name_en, start_date, end_date, review_grace_days) on public.seasons to authenticated;
grant update (name_th, name_en, start_date, end_date, review_grace_days, status, deleted_at) on public.seasons to authenticated;
grant insert (season_id, points_per_km, min_distance_km, max_backdate_days, max_evidence_files,
              flag_min_pace_sec_per_km, flag_max_pace_sec_per_km, flag_max_distance_km, flag_max_daily_km,
              change_reason) on public.season_rules to authenticated;
grant insert (season_id, user_id, added_by) on public.season_participants to authenticated;
grant update (removed_at) on public.season_participants to authenticated;
grant update (status, note, processed_by, processed_at) on public.data_deletion_requests to authenticated;
grant update (evidence_retention_days, audit_retention_days, login_max_failures, login_lock_minutes,
              current_privacy_notice_version, updated_by) on public.system_settings to authenticated;

-- ฟังก์ชันที่ผู้ใช้ทั่วไปเรียกได้ (helper ที่ RLS ใช้ต้องเรียกได้ด้วย)
grant execute on function
  public.app_today(),
  public.current_profile_id(),
  public.has_role(public.app_role),
  public.is_reviewer(),
  public.compute_points(numeric, numeric),
  -- ใช้ใน trigger ที่ทำงานด้วยสิทธิ์ผู้เรียก (แอดมินแก้ฤดูกาล/กติกาโดยตรง)
  public.raise_app_error(text, jsonb),
  public.audit_actor(),
  public.rules_bypassed(),
  public.current_rule(uuid),
  public.submit_run(date, numeric, int, text, jsonb, uuid),
  public.cancel_run(uuid),
  public.update_my_profile(text, text),
  public.accept_privacy_notice(text),
  public.mark_password_changed(),
  public.request_data_deletion(text),
  public.review_run(uuid, public.review_decision, text),
  public.review_runs_bulk(uuid[], public.review_decision, text),
  public.adjust_points(uuid, uuid, numeric, text),
  public.recalculate_season(uuid, text),
  public.close_season(uuid, text),
  public.copy_participants(uuid, uuid),
  public.close_user_account(uuid, uuid)
to authenticated;

-- service_role เท่านั้น (เรียกจาก server/cron)
grant execute on function
  public.admin_provision_user(uuid, uuid, text, text, uuid, public.app_role[]),
  public.evidence_due_for_purge(int),
  public.mark_evidence_purged(uuid[]),
  public.purge_expired_audit_logs(),
  public.is_login_locked(text),
  public.record_login_attempt(text, text, boolean),
  public.refresh_leaderboard(uuid)
to service_role;

-- ฟังก์ชันใหม่ในอนาคตไม่ให้ public เรียกได้โดยอัตโนมัติ
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ============================== supabase/seed.sql
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
