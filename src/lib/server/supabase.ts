import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

/** client ในนามผู้ใช้ (JWT ของผู้ใช้) — RLS ในฐานข้อมูลบังคับใช้เสมอ */
export function userClient(accessToken: string): SupabaseClient {
  const e = env();
  return createClient(e.SUPABASE_URL, e.SUPABASE_ANON_KEY, {
    auth: noSession,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** client ไม่ระบุตัวตน — ใช้ล็อกอินและต่ออายุ session เท่านั้น */
export function anonClient(): SupabaseClient {
  const e = env();
  return createClient(e.SUPABASE_URL, e.SUPABASE_ANON_KEY, { auth: noSession });
}

/**
 * client สิทธิ์สูงสุด (ข้าม RLS) — ใช้เฉพาะ: สร้าง/รีเซ็ตบัญชี, ตรวจล็อกบัญชี, cron
 * ห้ามส่งผลลัพธ์ดิบไปหน้าเว็บโดยไม่ตรวจสิทธิ์ก่อน
 */
export function serviceClient(): SupabaseClient {
  const e = env();
  return createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: noSession });
}

export function authEmail(employeeCode: string): string {
  return `${employeeCode.trim().toLowerCase()}@${env().AUTH_EMAIL_DOMAIN}`;
}
