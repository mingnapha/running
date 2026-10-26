import { createClient } from "@supabase/supabase-js";
import type { R2BucketLike } from "@/lib/server/cloudflare";
import { runDailyJobs, type CronDb } from "./jobs";

interface CronEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  EVIDENCE_BUCKET: R2BucketLike;
}

/** ผูกงานรายวันเข้ากับ Supabase (service role) และ R2 จริง */
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
  const bucket = {
    delete: (keys: string[]) => env.EVIDENCE_BUCKET.delete(keys),
    list: (opts: { prefix: string; cursor?: string; limit: number }) => env.EVIDENCE_BUCKET.list(opts),
  };
  const result = await runDailyJobs(db, bucket);
  console.log("daily jobs done", JSON.stringify(result));
}
