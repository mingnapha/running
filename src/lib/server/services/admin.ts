import "server-only";
import { generateTemporaryPassword } from "@/lib/domain/password";
import type { Role, SeasonRules } from "@/lib/domain/types";
import type { Department, Season, SeasonRulesDto, UserAdmin } from "@/lib/dto";
import { AppError, fromDbError, unwrap } from "../errors";
import type { AuthContext } from "../session";
import { authEmail, serviceClient } from "../supabase";
import { mapRules, mapSeason, SEASON_COLUMNS, type RulesRow, type SeasonRow } from "./seasons";

// -----------------------------------------------------------------------------
// ฤดูกาลและกติกา
// -----------------------------------------------------------------------------
export interface SeasonInput {
  nameTh: string;
  nameEn: string;
  startDate: string;
  endDate: string;
}

const seasonRow = (i: SeasonInput) => ({ name_th: i.nameTh, name_en: i.nameEn, start_date: i.startDate, end_date: i.endDate });

export async function createSeason(auth: AuthContext, input: SeasonInput): Promise<Season> {
  return mapSeason(unwrap(await auth.db.from("seasons").insert(seasonRow(input)).select(SEASON_COLUMNS).single()) as SeasonRow);
}

export async function updateSeason(auth: AuthContext, seasonId: string, input: SeasonInput): Promise<Season> {
  const row = unwrap(
    await auth.db.from("seasons").update(seasonRow(input)).eq("id", seasonId).select(SEASON_COLUMNS).maybeSingle(),
  ) as SeasonRow | null;
  if (!row) throw new AppError("NOT_FOUND", 404);
  return mapSeason(row);
}

export async function deleteSeason(auth: AuthContext, seasonId: string): Promise<void> {
  unwrap(await auth.db.from("seasons").update({ deleted_at: new Date().toISOString() }).eq("id", seasonId));
}

export async function activateSeason(auth: AuthContext, seasonId: string): Promise<Season> {
  const res = await auth.db.from("seasons").update({ status: "active" }).eq("id", seasonId).select(SEASON_COLUMNS).maybeSingle();
  if (res.error?.code === "23505") throw new AppError("ACTIVE_SEASON_EXISTS", 409);
  const row = unwrap(res) as SeasonRow | null;
  if (!row) throw new AppError("NOT_FOUND", 404);
  return mapSeason(row);
}

export async function closeSeason(auth: AuthContext, seasonId: string, reason: string | undefined): Promise<Season> {
  unwrap(await auth.db.rpc("close_season", { p_season_id: seasonId, p_reason: reason ?? null }));
  return mapSeason(unwrap(await auth.db.from("seasons").select(SEASON_COLUMNS).eq("id", seasonId).single()) as SeasonRow);
}

export async function addRulesVersion(
  auth: AuthContext,
  seasonId: string,
  rules: SeasonRules,
  changeReason: string,
  recalculate: boolean,
): Promise<{ rules: SeasonRulesDto; recalculatedRuns: number }> {
  const row = unwrap(
    await auth.db
      .from("season_rules")
      .insert({
        season_id: seasonId,
        points_per_km: rules.pointsPerKm,
        min_distance_km: rules.minDistanceKm,
        max_backdate_days: rules.maxBackdateDays,
        max_evidence_files: rules.maxEvidenceFiles,
        flag_min_pace_sec_per_km: rules.flagMinPaceSecPerKm,
        flag_max_pace_sec_per_km: rules.flagMaxPaceSecPerKm,
        flag_max_distance_km: rules.flagMaxDistanceKm,
        flag_max_daily_km: rules.flagMaxDailyKm,
        change_reason: changeReason,
      })
      .select("*")
      .single(),
  ) as RulesRow;
  let recalculatedRuns = 0;
  if (recalculate) {
    recalculatedRuns = unwrap(
      await auth.db.rpc("recalculate_season", { p_season_id: seasonId, p_reason: changeReason }),
    ) as number;
  }
  return { rules: mapRules(row), recalculatedRuns };
}

// -----------------------------------------------------------------------------
// ผู้มีสิทธิ์เล่น
// -----------------------------------------------------------------------------
interface ProfileWithDept {
  id: string;
  employee_code: string;
  display_name: string;
  is_active: boolean;
  must_change_password: boolean;
  consented_at: string | null;
  created_at: string;
  departments: { id: string; code: string; name_th: string; name_en: string } | null;
  user_roles?: { role: Role }[];
}

const PROFILE_COLUMNS =
  "id, employee_code, display_name, is_active, must_change_password, consented_at, created_at, departments(id, code, name_th, name_en)";

function mapDept(d: ProfileWithDept["departments"]): Department | null {
  return d ? { id: d.id, code: d.code, nameTh: d.name_th, nameEn: d.name_en } : null;
}

function mapUser(p: ProfileWithDept): UserAdmin {
  return {
    id: p.id,
    employeeCode: p.employee_code,
    displayName: p.display_name,
    department: mapDept(p.departments),
    isActive: p.is_active,
    roles: (p.user_roles ?? []).map((r) => r.role),
    mustChangePassword: p.must_change_password,
    consentedAt: p.consented_at,
    createdAt: p.created_at,
  };
}

export async function listParticipants(auth: AuthContext, seasonId: string): Promise<UserAdmin[]> {
  const rows = unwrap(
    await auth.db
      .from("season_participants")
      .select(`profiles!season_participants_user_id_fkey(${PROFILE_COLUMNS}, user_roles!user_roles_user_id_fkey(role))`)
      .eq("season_id", seasonId)
      .is("removed_at", null),
  ) as unknown as { profiles: ProfileWithDept }[];
  return rows.map((r) => mapUser(r.profiles)).sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
}

export async function addParticipants(
  auth: AuthContext,
  seasonId: string,
  employeeCodes: string[],
): Promise<{ added: number; alreadyPresent: number; notFound: string[] }> {
  const codes = [...new Set(employeeCodes.map((c) => c.trim()).filter(Boolean))];
  const profiles = unwrap(
    await auth.db.from("profiles").select("id, employee_code").in("employee_code", codes).is("deleted_at", null),
  ) as { id: string; employee_code: string }[];
  const found = new Set(profiles.map((p) => p.employee_code.toLowerCase()));
  const notFound = codes.filter((c) => !found.has(c.toLowerCase()));
  const ids = profiles.map((p) => p.id);
  if (ids.length === 0) return { added: 0, alreadyPresent: 0, notFound };

  const existing = unwrap(
    await auth.db.from("season_participants").select("user_id, removed_at").eq("season_id", seasonId).in("user_id", ids),
  ) as { user_id: string; removed_at: string | null }[];
  const active = new Set(existing.filter((e) => e.removed_at === null).map((e) => e.user_id));
  const removed = existing.filter((e) => e.removed_at !== null).map((e) => e.user_id);
  const fresh = ids.filter((id) => !existing.some((e) => e.user_id === id));

  if (removed.length) {
    unwrap(await auth.db.from("season_participants").update({ removed_at: null }).eq("season_id", seasonId).in("user_id", removed));
  }
  if (fresh.length) {
    unwrap(
      await auth.db
        .from("season_participants")
        .insert(fresh.map((user_id) => ({ season_id: seasonId, user_id, added_by: auth.user.id }))),
    );
  }
  return { added: removed.length + fresh.length, alreadyPresent: active.size, notFound };
}

export async function removeParticipant(auth: AuthContext, seasonId: string, userId: string): Promise<void> {
  unwrap(
    await auth.db
      .from("season_participants")
      .update({ removed_at: new Date().toISOString() })
      .eq("season_id", seasonId)
      .eq("user_id", userId)
      .is("removed_at", null),
  );
}

// -----------------------------------------------------------------------------
// ผู้ใช้
// -----------------------------------------------------------------------------
export async function listUsers(
  auth: AuthContext,
  opts: { q?: string; active?: boolean; limit: number; offset: number },
): Promise<{ items: UserAdmin[]; total: number }> {
  let q = auth.db
    .from("profiles")
    .select(`${PROFILE_COLUMNS}, user_roles!user_roles_user_id_fkey(role)`, { count: "exact" })
    .is("deleted_at", null)
    .order("employee_code")
    .range(opts.offset, opts.offset + opts.limit - 1);
  if (opts.q) {
    const term = opts.q.replace(/[%,()"]/g, " ").trim();
    if (term) q = q.or(`employee_code.ilike.%${term}%,display_name.ilike.%${term}%`);
  }
  if (opts.active !== undefined) q = q.eq("is_active", opts.active);
  const res = await q;
  const rows = unwrap(res) as unknown as ProfileWithDept[];
  return { items: rows.map(mapUser), total: res.count ?? rows.length };
}

async function getUser(auth: AuthContext, userId: string): Promise<UserAdmin> {
  const row = unwrap(
    await auth.db.from("profiles").select(`${PROFILE_COLUMNS}, user_roles!user_roles_user_id_fkey(role)`).eq("id", userId).maybeSingle(),
  ) as unknown as ProfileWithDept | null;
  if (!row) throw new AppError("NOT_FOUND", 404);
  return mapUser(row);
}

export interface CreateUserInput {
  employeeCode: string;
  displayName: string;
  departmentId: string | null;
  roles: Role[];
  addToSeasonId?: string;
}

/** สร้างบัญชี Supabase Auth (อีเมลภายใน) + โปรไฟล์ — คืนรหัสผ่านชั่วคราว (แสดงครั้งเดียว) */
export async function createUser(auth: AuthContext, input: CreateUserInput): Promise<{ user: UserAdmin; temporaryPassword: string }> {
  const service = serviceClient();
  const temporaryPassword = generateTemporaryPassword();
  const created = await service.auth.admin.createUser({
    email: authEmail(input.employeeCode),
    password: temporaryPassword,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    if (created.error?.status === 422) throw new AppError("CONFLICT", 409, { field: "employeeCode" });
    throw new AppError("INTERNAL_ERROR", 500);
  }

  const provision = await service.rpc("admin_provision_user", {
    p_actor_id: auth.user.id,
    p_auth_user_id: created.data.user.id,
    p_employee_code: input.employeeCode.trim(),
    p_display_name: input.displayName.trim(),
    p_department_id: input.departmentId,
    p_roles: input.roles.length ? input.roles : ["runner"],
  });
  if (provision.error) {
    // ย้อนการสร้างบัญชี auth เพื่อไม่ให้มีบัญชีค้างที่ไม่มีโปรไฟล์
    await service.auth.admin.deleteUser(created.data.user.id).catch(() => undefined);
    throw fromDbError(provision.error);
  }
  const profileId = provision.data as string;
  if (input.addToSeasonId) await addParticipants(auth, input.addToSeasonId, [input.employeeCode]);
  return { user: await getUser(auth, profileId), temporaryPassword };
}

export async function updateUser(
  auth: AuthContext,
  userId: string,
  patch: { displayName?: string; departmentId?: string | null; isActive?: boolean },
): Promise<UserAdmin> {
  if (patch.isActive === false && userId === auth.user.id) throw new AppError("CANNOT_CLOSE_OWN_ACCOUNT", 422);
  const update: Record<string, unknown> = {};
  if (patch.displayName !== undefined) update.display_name = patch.displayName.trim();
  if (patch.departmentId !== undefined) update.department_id = patch.departmentId;
  if (patch.isActive !== undefined) update.is_active = patch.isActive;
  if (Object.keys(update).length) unwrap(await auth.db.from("profiles").update(update).eq("id", userId));
  return getUser(auth, userId);
}

export async function setRoles(auth: AuthContext, userId: string, roles: Role[]): Promise<UserAdmin> {
  if (userId === auth.user.id && !roles.includes("admin")) throw new AppError("CANNOT_REMOVE_OWN_ADMIN", 422);
  const current = (unwrap(await auth.db.from("user_roles").select("role").eq("user_id", userId)) as { role: Role }[]).map((r) => r.role);
  const toRemove = current.filter((r) => !roles.includes(r));
  const toAdd = roles.filter((r) => !current.includes(r));
  if (toRemove.length) unwrap(await auth.db.from("user_roles").delete().eq("user_id", userId).in("role", toRemove));
  if (toAdd.length) {
    unwrap(await auth.db.from("user_roles").insert(toAdd.map((role) => ({ user_id: userId, role, granted_by: auth.user.id }))));
  }
  return getUser(auth, userId);
}

export async function resetPassword(auth: AuthContext, userId: string): Promise<string> {
  const row = unwrap(
    await auth.db.from("profiles").select("auth_user_id").eq("id", userId).maybeSingle(),
  ) as { auth_user_id: string | null } | null;
  if (!row?.auth_user_id) throw new AppError("NOT_FOUND", 404);
  const temporaryPassword = generateTemporaryPassword();
  const { error } = await serviceClient().auth.admin.updateUserById(row.auth_user_id, { password: temporaryPassword });
  if (error) throw new AppError("INTERNAL_ERROR", 500);
  unwrap(await auth.db.from("profiles").update({ must_change_password: true }).eq("id", userId));
  return temporaryPassword;
}

export async function listDepartments(auth: AuthContext): Promise<Department[]> {
  const rows = unwrap(
    await auth.db.from("departments").select("id, code, name_th, name_en").is("deleted_at", null).order("code"),
  ) as { id: string; code: string; name_th: string; name_en: string }[];
  return rows.map((d) => ({ id: d.id, code: d.code, nameTh: d.name_th, nameEn: d.name_en }));
}
