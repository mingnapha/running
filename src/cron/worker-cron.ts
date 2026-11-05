import { createClient } from "@supabase/supabase-js";
import type { R2BucketLike } from "@/lib/server/cloudflare";
import { runDailyJobs, type CronBucket, type CronDb } from "./jobs";

interface CronEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** มีเมื่อเปิด Cloudflare R2 ไว้ใน wrangler.jsonc */
  EVIDENCE_BUCKET?: R2BucketLike;
}

/** ผูกงานรายวันเข้ากับ Supabase (service role) และที่เก็บรูป (Supabase Storage + R2 ถ้ามี) */
export async function scheduled(env: CronEnv): Promise<void> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const fail = (what: string, error: unknown): never => {
    throw new Error(`${what}: ${JSON.stringify(error)}`);
  };
  const db: CronDb = {
    async dueEvidence(limit) {
      const { data, error } = await supabase.rpc("evidence_due_for_purge", { p_limit: limit });
      return error ? fail("evidence_due_for_purge", error) : (data ?? []);
    },
    async markPurged(ids) {
      const { data, error } = await supabase.rpc("mark_evidence_purged", { p_ids: ids });
      return error ? fail("mark_evidence_purged", error) : Number(data ?? 0);
    },
    async existingKeys(keys) {
      const found = new Set<string>();
      for (let i = 0; i < keys.length; i += 200) {
        const { data, error } = await supabase.from("evidence_files").select("object_key").in("object_key", keys.slice(i, i + 200));
        if (error) fail("evidence_files", error);
        for (const row of data ?? []) found.add(row.object_key as string);
      }
      return found;
    },
    async purgeAuditLogs() {
      const { data, error } = await supabase.rpc("purge_expired_audit_logs");
      return error ? fail("purge_expired_audit_logs", error) : Number(data ?? 0);
    },
  };
  // ไม่ import ../lib/server/storage (มี server-only) — Worker cron ไม่ได้รันผ่าน Next.js
  const buckets: CronBucket[] = [
    {
      provider: "supabase",
      async delete(keys) {
        for (let i = 0; i < keys.length; i += 100) {
          const { error } = await supabase.storage.from("evidence").remove(keys.slice(i, i + 100));
          if (error) fail("storage.remove", error);
        }
      },
      // Supabase Storage ไล่ไฟล์ทั้ง bucket ไม่ได้ในครั้งเดียว — ข้ามการลบไฟล์กำพร้า (โควต้าอัปโหลดจำกัดปริมาณไว้แล้ว)
      list: async () => ({ objects: [], truncated: false }),
    },
  ];
  const r2 = env.EVIDENCE_BUCKET;
  if (r2) {
    buckets.push({ provider: "r2", delete: (keys) => r2.delete(keys), list: (opts) => r2.list(opts) });
  }
  const result = await runDailyJobs(db, buckets);
  console.log("daily jobs done", JSON.stringify(result));
}
