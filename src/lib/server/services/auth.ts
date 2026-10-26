import "server-only";
import { checkPassword } from "@/lib/domain/password";
import { AppError, unwrap } from "../errors";
import { clientIp, saltedHash, verifyTurnstile } from "../security";
import { clearSession, getAccessToken, loadCurrentUser, writeSession, type AuthContext, type CurrentUser } from "../session";
import { anonClient, authEmail, serviceClient, userClient } from "../supabase";

/**
 * ล็อกอิน: Turnstile → ตรวจล็อกบัญชี → Supabase Auth → บันทึกผล → ตั้งคุกกี้
 * ตอบ INVALID_CREDENTIALS เหมือนกันทุกกรณีที่ไม่ผ่าน (ไม่บอกว่ารหัสพนักงานไหนมีอยู่)
 */
export async function login(
  input: { username: string; password: string; turnstileToken: string },
  headers: Headers,
): Promise<CurrentUser> {
  const ip = clientIp(headers);
  if (!(await verifyTurnstile(input.turnstileToken, ip))) throw new AppError("TURNSTILE_FAILED", 400);

  const service = serviceClient();
  const usernameHash = await saltedHash(input.username.trim().toLowerCase());
  const ipHash = ip ? await saltedHash(ip) : null;

  if (unwrap(await service.rpc("is_login_locked", { p_username_hash: usernameHash })) === true) {
    throw new AppError("ACCOUNT_LOCKED", 423);
  }

  const { data, error } = await anonClient().auth.signInWithPassword({
    email: authEmail(input.username),
    password: input.password,
  });
  let user: CurrentUser | null = null;
  if (!error && data.session) {
    user = await loadCurrentUser(userClient(data.session.access_token));
  }
  await service.rpc("record_login_attempt", { p_username_hash: usernameHash, p_ip_hash: ipHash, p_succeeded: user !== null });

  if (!user || !data.session) throw new AppError("INVALID_CREDENTIALS", 401);
  await writeSession(data.session);
  return user;
}

export async function logout(): Promise<void> {
  const token = await getAccessToken(true).catch(() => null);
  if (token) {
    // เพิกถอน refresh token ฝั่ง Supabase ด้วย (ไม่สนใจ error)
    await serviceClient().auth.admin.signOut(token).catch(() => undefined);
  }
  await clearSession();
}

/** เปลี่ยนรหัสผ่าน (บังคับครั้งแรก) — ตรวจรหัสเดิมก่อน แล้วออก session ใหม่ */
export async function changePassword(auth: AuthContext, currentPassword: string, newPassword: string): Promise<void> {
  const problems = checkPassword(newPassword, auth.user.employeeCode, currentPassword);
  if (problems.length) throw new AppError("WEAK_PASSWORD", 400, { problems });

  const email = authEmail(auth.user.employeeCode);
  const verify = await anonClient().auth.signInWithPassword({ email, password: currentPassword });
  if (verify.error || !verify.data.user) throw new AppError("INVALID_CREDENTIALS", 401);

  const { error } = await serviceClient().auth.admin.updateUserById(verify.data.user.id, { password: newPassword });
  if (error) throw new AppError("INTERNAL_ERROR", 500);

  const fresh = await anonClient().auth.signInWithPassword({ email, password: newPassword });
  if (fresh.error || !fresh.data.session) throw new AppError("INTERNAL_ERROR", 500);
  await writeSession(fresh.data.session);
  unwrap(await userClient(fresh.data.session.access_token).rpc("mark_password_changed"));
}
