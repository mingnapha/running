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

create policy profiles_read on public.profiles for select to authenticated
  using (id = public.current_profile_id() or public.has_role('admin'));

create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = public.current_profile_id() or public.has_role('admin'));

create policy seasons_read on public.seasons for select to authenticated
  using (deleted_at is null or public.has_role('admin'));

create policy season_rules_read on public.season_rules for select to authenticated using (true);

create policy season_participants_read on public.season_participants for select to authenticated
  using (user_id = public.current_profile_id() or public.is_reviewer());

create policy runs_read on public.runs for select to authenticated
  using (user_id = public.current_profile_id() or public.is_reviewer());

create policy run_flags_read on public.run_flags for select to authenticated
  using (public.is_reviewer());

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
  public.submit_run(date, numeric, int, text, jsonb),
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
