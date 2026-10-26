import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/server/supabase";

/** ตรวจสุขภาพระบบ — Cron เรียกทุกวันเพื่อกัน Supabase Free หยุดทำงาน */
export async function GET() {
  let db = false;
  try {
    const { error } = await serviceClient().from("system_settings").select("id").limit(1);
    db = !error;
  } catch {
    db = false;
  }
  return NextResponse.json({ ok: db, db }, { status: db ? 200 : 503, headers: { "cache-control": "no-store" } });
}
