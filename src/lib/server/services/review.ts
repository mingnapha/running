import "server-only";
import type { RunDetail } from "@/lib/dto";
import { unwrap } from "../errors";
import type { AuthContext } from "../session";
import { getRunDetail, getRunDetails, RUN_COLUMNS, type RunRow } from "./runs";

export const QUEUE_PAGE_SIZE = 50;

/** คิวรอตรวจ เก่าสุดก่อน — ไม่รวมรายการของผู้ตรวจเอง */
export async function getReviewQueue(
  auth: AuthContext,
  opts: { seasonId: string; flagged?: boolean; limit?: number },
): Promise<{ items: RunDetail[]; totalPending: number }> {
  const limit = Math.min(opts.limit ?? QUEUE_PAGE_SIZE, 100);
  const base = auth.db
    .from("runs")
    .select(RUN_COLUMNS, { count: "exact" })
    .eq("season_id", opts.seasonId)
    .eq("status", "pending")
    .neq("user_id", auth.user.id)
    .order("submitted_at", { ascending: true });

  // กรองตามธงในหน่วยความจำ — คิวรอตรวจมีขนาดเล็ก (หลักสิบถึงหลักร้อย)
  const res = await (opts.flagged === undefined ? base.limit(limit) : base.limit(500));
  const rows = unwrap(res) as RunRow[];
  let items = await getRunDetails(auth.db, rows, true);
  if (opts.flagged !== undefined) {
    items = items.filter((r) => (r.flags.length > 0) === opts.flagged).slice(0, limit);
  }
  return { items, totalPending: res.count ?? rows.length };
}

export async function decideRun(
  auth: AuthContext,
  runId: string,
  decision: "approved" | "rejected",
  reason: string | undefined,
): Promise<RunDetail> {
  unwrap(await auth.db.rpc("review_run", { p_run_id: runId, p_decision: decision, p_reason: reason ?? null }));
  return getRunDetail(auth, runId);
}
