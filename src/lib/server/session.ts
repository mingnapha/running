import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Role } from "@/lib/domain/types";
import { isProduction } from "./env";
import { AppError, unwrap } from "./errors";
import { anonClient, userClient } from "./supabase";

/**
 * Session เก็บในคุกกี้ httpOnly (JavaScript ในหน้าเว็บอ่านไม่ได้)
 * ภายในคือ access/refresh token ของ Supabase Auth — ต่ออายุอัตโนมัติก่อนหมดอายุ 60 วินาที
 */
export const SESSION_COOKIE = "wr-session";
export const LOCALE_COOKIE = "wr-locale";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;
const REFRESH_MARGIN_SECONDS = 60;

interface SessionTokens {
  a: string; // access token
  r: string; // refresh token
  e: number; // expires_at (unix seconds)
}

function encode(t: SessionTokens): string {
  return Buffer.from(JSON.stringify(t)).toString("base64url");
}

function decode(raw: string | undefined): SessionTokens | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(Buffer.from(raw, "base64url").toString()) as Partial<SessionTokens>;
    return typeof t.a === "string" && typeof t.r === "string" && typeof t.e === "number" ? (t as SessionTokens) : null;
  } catch {
    return null;
  }
}

export async function writeSession(session: { access_token: string; refresh_token: string; expires_at?: number }) {
  const store = await cookies();
  store.set(SESSION_COOKIE, encode({ a: session.access_token, r: session.refresh_token, e: session.expires_at ?? 0 }), {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/** ภาษาของหน้าเว็บ (next-intl อ่านจากคุกกี้นี้) */
export async function writeLocale(locale: "th" | "en") {
  (await cookies()).set(LOCALE_COOKIE, locale, { httpOnly: false, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** session หมดอายุ แต่อยู่ใน Server Component (ตั้งคุกกี้ไม่ได้) → ให้ redirect ไปต่ออายุ */
export class SessionRefreshRequired extends Error {}

/**
 * token ที่ใช้ได้ของคำขอนี้ (ต่ออายุถ้าจำเป็น)
 * canWriteCookies = true ใน Route Handler / Server Action
 */
export async function getAccessToken(canWriteCookies: boolean): Promise<string | null> {
  const tokens = decode((await cookies()).get(SESSION_COOKIE)?.value);
  if (!tokens) return null;
  if (tokens.e - Date.now() / 1000 > REFRESH_MARGIN_SECONDS) return tokens.a;
  if (!canWriteCookies) throw new SessionRefreshRequired();

  const { data, error } = await anonClient().auth.refreshSession({ refresh_token: tokens.r });
  if (error || !data.session) {
    await clearSession();
    return null;
  }
  await writeSession(data.session);
  return data.session.access_token;
}

export interface CurrentUser {
  id: string;
  employeeCode: string;
  displayName: string;
  department: { id: string; code: string; nameTh: string; nameEn: string } | null;
  locale: "th" | "en";
  roles: Role[];
  mustChangePassword: boolean;
  needsConsent: boolean;
}

export interface AuthContext {
  user: CurrentUser;
  db: SupabaseClient;
  accessToken: string;
}

interface ProfileRow {
  id: string;
  employee_code: string;
  display_name: string;
  locale: "th" | "en";
  must_change_password: boolean;
  privacy_notice_version: string | null;
  departments: { id: string; code: string; name_th: string; name_en: string } | null;
}

export async function loadCurrentUser(db: SupabaseClient): Promise<CurrentUser | null> {
  const profileId = unwrap(await db.rpc("current_profile_id")) as string | null;
  if (!profileId) return null;

  const [profile, roles, settings] = await Promise.all([
    db
      .from("profiles")
      .select("id, employee_code, display_name, locale, must_change_password, privacy_notice_version, departments(id, code, name_th, name_en)")
      .eq("id", profileId)
      .single<ProfileRow>(),
    db.from("user_roles").select("role").eq("user_id", profileId),
    db.from("system_settings").select("current_privacy_notice_version").single<{ current_privacy_notice_version: string }>(),
  ]);
  const p = unwrap(profile);
  const d = p.departments;
  return {
    id: p.id,
    employeeCode: p.employee_code,
    displayName: p.display_name,
    department: d ? { id: d.id, code: d.code, nameTh: d.name_th, nameEn: d.name_en } : null,
    locale: p.locale,
    roles: (unwrap(roles) as { role: Role }[]).map((r) => r.role),
    mustChangePassword: p.must_change_password,
    needsConsent: p.privacy_notice_version !== unwrap(settings).current_privacy_notice_version,
  };
}

export interface RequireOptions {
  /** อนุญาตก่อนผ่านด่านบังคับ (เปลี่ยนรหัสผ่าน / ยอมรับประกาศ) */
  allowGated?: boolean;
  roles?: Role[];
  canWriteCookies?: boolean;
}

/** ใช้ใน API: คืนผู้ใช้ปัจจุบันหรือโยน 401/403 */
export async function requireAuth(options: RequireOptions = {}): Promise<AuthContext> {
  const accessToken = await getAccessToken(options.canWriteCookies ?? true);
  if (!accessToken) throw new AppError("NOT_AUTHENTICATED", 401);
  const db = userClient(accessToken);
  const user = await loadCurrentUser(db);
  if (!user) throw new AppError("NOT_AUTHENTICATED", 401);
  if (!options.allowGated) {
    if (user.mustChangePassword) throw new AppError("PASSWORD_CHANGE_REQUIRED", 403);
    if (user.needsConsent) throw new AppError("CONSENT_REQUIRED", 403);
  }
  if (options.roles && !options.roles.some((r) => user.roles.includes(r))) {
    throw new AppError("FORBIDDEN", 403);
  }
  return { user, db, accessToken };
}

export function hasRole(user: CurrentUser, ...roles: Role[]): boolean {
  return roles.some((r) => user.roles.includes(r));
}
