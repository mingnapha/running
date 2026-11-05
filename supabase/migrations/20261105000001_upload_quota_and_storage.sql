-- =============================================================================
-- workingRun — เพดานการอัปโหลดรูป + ที่เก็บรูปบน Supabase Storage
--
-- เพดานกันค่าใช้จ่ายบานปลาย/การใช้งานผิดปกติ (ปรับได้ใน system_settings):
--   ต่อคน:   ไม่เกิน 20 รูป/ชั่วโมง และ 60 รูป/วัน
--   ทั้งระบบ: ไม่เกิน 1,000 รูป/วัน และพื้นที่รูปรวมไม่เกิน 7 GB
--             (R2 ฟรี 10 GB — เผื่อไฟล์ที่อัปโหลดค้างก่อนงานรายวันลบ ≤ 2 GB)
-- ผลรวม: ไม่มีทางเกินโควต้าฟรีของ R2 → ไม่มีค่าใช้จ่าย
--   (การเปิดดูรูปถูกจำกัดโดยโควต้าฟรีของ Workers 100,000 คำขอ/วัน ซึ่งต่ำกว่าโควต้าอ่านฟรีของ R2)
-- =============================================================================

alter table public.system_settings
  add column upload_limit_per_user_hour smallint not null default 20 check (upload_limit_per_user_hour between 1 and 1000),
  add column upload_limit_per_user_day  smallint not null default 60 check (upload_limit_per_user_day between 1 and 5000),
  add column upload_limit_global_day    int      not null default 1000 check (upload_limit_global_day between 1 and 100000),
  add column storage_limit_bytes        bigint   not null default 7516192768 check (storage_limit_bytes > 0);

create index evidence_files_active_size_idx on public.evidence_files (purged_at) include (byte_size);

create table public.evidence_upload_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id),
  created_at  timestamptz not null default now()
);
create index evidence_upload_log_user_idx on public.evidence_upload_log (user_id, created_at desc);
create index evidence_upload_log_created_idx on public.evidence_upload_log (created_at);
alter table public.evidence_upload_log enable row level security;
-- ไม่มี policy: เขียนผ่านฟังก์ชันด้านล่างเท่านั้น
grant all on public.evidence_upload_log to service_role;

-- เรียกก่อนเก็บไฟล์ทุกครั้ง — เกินเพดาน → UPLOAD_RATE_LIMITED (ไม่เก็บไฟล์)
create or replace function public.register_evidence_upload()
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := public.current_profile_id();
  v_set  public.system_settings;
begin
  if v_user is null then perform public.raise_app_error('NOT_AUTHENTICATED'); end if;
  select s.* into v_set from public.system_settings s where s.id = 1;
  -- ล็อกกันคำขอพร้อมกันนับเกิน
  perform pg_advisory_xact_lock(hashtextextended('evidence_upload', 0));

  if (select count(*) from public.evidence_upload_log l
      where l.user_id = v_user and l.created_at > now() - interval '1 hour') >= v_set.upload_limit_per_user_hour
  or (select count(*) from public.evidence_upload_log l
      where l.user_id = v_user and l.created_at > now() - interval '1 day') >= v_set.upload_limit_per_user_day then
    perform public.raise_app_error('UPLOAD_RATE_LIMITED', jsonb_build_object('scope', 'user'));
  end if;
  if (select count(*) from public.evidence_upload_log l
      where l.created_at > now() - interval '1 day') >= v_set.upload_limit_global_day then
    perform public.raise_app_error('UPLOAD_RATE_LIMITED', jsonb_build_object('scope', 'global'));
  end if;

  if (select coalesce(sum(e.byte_size), 0) from public.evidence_files e where e.purged_at is null)
     >= v_set.storage_limit_bytes then
    perform public.raise_app_error('STORAGE_FULL');
  end if;

  insert into public.evidence_upload_log (user_id) values (v_user);
  delete from public.evidence_upload_log where created_at < now() - interval '2 days';
end $$;

revoke execute on function public.register_evidence_upload() from public, anon;
grant execute on function public.register_evidence_upload() to authenticated;

-- บันทึกว่ารูปเก็บที่ไหน (r2 / supabase) — ส่งมาจาก server
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
    if not coalesce((v_item ->> 'object_key') like ('evidence/' || v_user || '/%'), false) then
      perform public.raise_app_error('INVALID_EVIDENCE_KEY');
    end if;
    insert into public.evidence_files (run_id, storage_provider, object_key, content_sha256, mime_type, byte_size)
    values (v_run.id, coalesce(v_item ->> 'storage_provider', 'r2'), v_item ->> 'object_key',
            v_item ->> 'content_sha256', v_item ->> 'mime_type', (v_item ->> 'byte_size')::int);
  end loop;

  return v_run;
end $$;

-- ที่เก็บรูปบน Supabase Storage (ใช้เมื่อไม่ได้เปิด Cloudflare R2): bucket ส่วนตัว, ไฟล์ละไม่เกิน 2 MB, รูปเท่านั้น
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('evidence', 'evidence', false, 2097152, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
    on conflict (id) do update
      set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;
