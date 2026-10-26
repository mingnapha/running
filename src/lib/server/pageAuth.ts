import "server-only";
import { notFound, redirect } from "next/navigation";
import type { Role } from "@/lib/domain/types";
import { AppError } from "./errors";
import { requireAuth, SessionRefreshRequired, type AuthContext } from "./session";

/**
 * ใช้ใน Server Component (หน้าเว็บ): ไม่มี session → /login, token ใกล้หมดอายุ → ไปต่ออายุแล้วกลับมา,
 * ยังไม่ผ่านด่านบังคับ → หน้าเปลี่ยนรหัสผ่าน / ยอมรับประกาศ
 */
export async function requirePageAuth(
  currentPath: string,
  options: { roles?: Role[]; gate?: "password" | "consent" } = {},
): Promise<AuthContext> {
  let auth: AuthContext;
  try {
    auth = await requireAuth({ allowGated: true, canWriteCookies: false });
  } catch (err) {
    if (err instanceof SessionRefreshRequired) {
      redirect(`/api/v1/auth/refresh?next=${encodeURIComponent(currentPath)}`);
    }
    if (err instanceof AppError && err.status === 401) redirect("/login");
    throw err;
  }

  const { user } = auth;
  if (user.mustChangePassword && options.gate !== "password") redirect("/change-password");
  if (!user.mustChangePassword && user.needsConsent && options.gate !== "consent") redirect("/consent");
  if (options.roles && !options.roles.some((r) => user.roles.includes(r))) notFound();
  return auth;
}
