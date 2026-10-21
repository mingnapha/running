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
  employee_code          extensions.citext check (employee_code ~ '^[A-Za-z0-9._-]{3,32}$'),
  display_name           text not null check (length(btrim(display_name)) between 1 and 60),
  department_id          uuid references public.departments (id),
  locale                 text not null default 'th' check (locale in ('th', 'en')),
  must_change_password   boolean not null default true,
  is_active              boolean not null default true,
  privacy_notice_version text,
  consented_at           timestamptz,
  anonymized_at          timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  -- ผู้ใช้ที่ยังไม่ถูก anonymize ต้องมีรหัสพนักงาน
  constraint profiles_code_required check (anonymized_at is not null or employee_code is not null),
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
