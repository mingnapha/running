import "server-only";
import { z } from "zod";

/**
 * ตัวแปรสภาพแวดล้อมฝั่ง server — ตั้งใน Cloudflare (wrangler secret) หรือ .dev.vars ตอนพัฒนา
 * ห้ามขึ้นต้นด้วย NEXT_PUBLIC_ ยกเว้นค่าที่เปิดเผยได้ (site key ของ Turnstile)
 */
const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1),
  /** โดเมนอีเมลภายในสำหรับ Supabase Auth — ผู้ใช้ไม่เห็น ไม่มีการส่งอีเมล */
  AUTH_EMAIL_DOMAIN: z.string().default("users.workingrun.internal"),
  /** เกลือสำหรับ hash username/IP ในตาราง login_attempts */
  LOGIN_HASH_SALT: z.string().min(16),
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  /** ใช้ได้เฉพาะตอนพัฒนา/ทดสอบ (เช่น stub บนเครื่อง) — production ใช้ของ Cloudflare เสมอ */
  TURNSTILE_VERIFY_URL: z.url().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Invalid server environment: ${missing}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export function isProduction(): boolean {
  return env().NODE_ENV === "production";
}
