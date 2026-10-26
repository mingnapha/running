import { NextResponse, type NextRequest } from "next/server";
import { getAccessToken } from "@/lib/server/session";

/**
 * ต่ออายุ session แล้วพากลับหน้าเดิม — Server Component ตั้งคุกกี้เองไม่ได้ จึง redirect มาที่นี่
 * (ไม่ใช่ endpoint สาธารณะใน OpenAPI)
 */
export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const token = await getAccessToken(true);
  return NextResponse.redirect(new URL(token ? safeNext : "/login", req.url));
}
