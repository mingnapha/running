import "server-only";
import { env, isProduction } from "./env";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** hash พร้อมเกลือ — เก็บใน login_attempts แทน username/IP จริง */
export function saltedHash(value: string): Promise<string> {
  return sha256Hex(`${env().LOGIN_HASH_SALT}:${value}`);
}

/** IP ของผู้ใช้ — Cloudflare ส่งมาใน CF-Connecting-IP */
export function clientIp(headers: Headers): string | null {
  return headers.get("cf-connecting-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/** ตรวจ token ของ Cloudflare Turnstile ฝั่ง server */
export async function verifyTurnstile(token: string, ip: string | null): Promise<boolean> {
  const body = new FormData();
  body.append("secret", env().TURNSTILE_SECRET_KEY);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  try {
    const url = isProduction() ? TURNSTILE_VERIFY_URL : (env().TURNSTILE_VERIFY_URL ?? TURNSTILE_VERIFY_URL);
    const res = await fetch(url, { method: "POST", body });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    console.error("Turnstile verification failed", err);
    return false;
  }
}
