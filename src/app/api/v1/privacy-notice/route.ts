import { json, route } from "@/lib/server/api";
import { unwrap } from "@/lib/server/errors";
import { requireAuth } from "@/lib/server/session";

/** เนื้อหาประกาศอยู่ใน messages/*.json (privacy.body) — endpoint นี้คืนเวอร์ชันปัจจุบัน */
export const GET = route(async () => {
  const auth = await requireAuth({ allowGated: true });
  const row = unwrap(await auth.db.from("system_settings").select("current_privacy_notice_version").single()) as {
    current_privacy_notice_version: string;
  };
  return json({ version: row.current_privacy_notice_version });
});
