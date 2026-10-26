import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FlagCode, RunStatus } from "@/lib/domain/types";
import type { EvidenceRef, Paged, Review, Run, RunDetail, UploadedEvidence } from "@/lib/dto";
import { evidenceBucket } from "../cloudflare";
import { AppError, unwrap } from "../errors";
import { sha256Hex } from "../security";
import type { AuthContext } from "../session";
import { num } from "./seasons";

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

export function evidencePrefix(profileId: string): string {
  return `evidence/${profileId}/`;
}

// -----------------------------------------------------------------------------
// อัปโหลดรูป → R2
// -----------------------------------------------------------------------------
export async function uploadEvidence(auth: AuthContext, file: File): Promise<UploadedEvidence> {
  const ext = MIME_EXT[file.type];
  if (!ext) throw new AppError("UNSUPPORTED_FILE_TYPE", 415);
  if (file.size === 0) throw new AppError("VALIDATION_ERROR", 400, { fields: { file: "empty" } });
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError("FILE_TOO_LARGE", 413, { max_bytes: MAX_UPLOAD_BYTES });

  const bytes = await file.arrayBuffer();
  const contentSha256 = await sha256Hex(bytes);
  const objectKey = `${evidencePrefix(auth.user.id)}${crypto.randomUUID()}.${ext}`;
  await evidenceBucket().put(objectKey, bytes, {
    httpMetadata: { contentType: file.type },
    customMetadata: { sha256: contentSha256, owner: auth.user.id },
  });
  return { objectKey, contentSha256, mimeType: file.type, byteSize: bytes.byteLength };
}

// -----------------------------------------------------------------------------
// บันทึกการวิ่ง
// -----------------------------------------------------------------------------
export interface SubmitRunInput {
  runDate: string;
  distanceKm: number;
  durationSeconds: number;
  note?: string;
  evidenceKeys: string[];
}

export async function submitRun(auth: AuthContext, input: SubmitRunInput, idempotencyKey: string | null): Promise<Run> {
  const prefix = evidencePrefix(auth.user.id);
  const bucket = evidenceBucket();
  // ข้อมูลรูปมาจาก R2 (ที่ server เป็นคนเขียน) ไม่เชื่อค่าที่ client ส่งมา
  const evidence = await Promise.all(
    input.evidenceKeys.map(async (key) => {
      if (!key.startsWith(prefix) || key.includes("..")) throw new AppError("INVALID_EVIDENCE_KEY", 422);
      const head = await bucket.head(key);
      if (!head || head.customMetadata?.owner !== auth.user.id) throw new AppError("EVIDENCE_NOT_FOUND", 422);
      return {
        object_key: key,
        content_sha256: head.customMetadata?.sha256,
        mime_type: head.httpMetadata?.contentType,
        byte_size: head.size,
      };
    }),
  );

  const row = unwrap(
    await auth.db.rpc("submit_run", {
      p_run_date: input.runDate,
      p_distance_km: input.distanceKm,
      p_duration_seconds: input.durationSeconds,
      p_note: input.note ?? null,
      p_evidence: evidence,
      p_client_request_id: idempotencyKey,
    }),
  ) as RunRow;
  const [run] = await hydrateRuns(auth.db, [row]);
  return run!;
}

export async function cancelRun(auth: AuthContext, runId: string): Promise<void> {
  unwrap(await auth.db.rpc("cancel_run", { p_run_id: runId }));
}

// -----------------------------------------------------------------------------
// อ่านรายการวิ่ง
// -----------------------------------------------------------------------------
export interface RunRow {
  id: string;
  user_id: string;
  season_id: string;
  run_date: string;
  distance_km: number | string;
  duration_seconds: number;
  pace_sec_per_km: number;
  note: string | null;
  status: RunStatus;
  submitted_at: string;
  decided_at: string | null;
}

const RUN_COLUMNS = "id, user_id, season_id, run_date, distance_km, duration_seconds, pace_sec_per_km, note, status, submitted_at, decided_at";

interface ReviewRow {
  run_id: string;
  reviewer_id: string;
  decision: Review["decision"];
  reason: string | null;
  created_at: string;
}

const REVIEW_COLUMNS = "run_id, reviewer_id, decision, reason, created_at";

/** ชื่อที่แสดงของผู้ใช้ (ผ่าน view public_profiles — ไม่มีรหัสพนักงาน) */
async function displayNames(db: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = unwrap(await db.from("public_profiles").select("id, display_name").in("id", [...new Set(ids)])) as {
    id: string;
    display_name: string;
  }[];
  return new Map(rows.map((r) => [r.id, r.display_name]));
}

function mapReview(x: ReviewRow, names: Map<string, string>): Review {
  return { decision: x.decision, reason: x.reason, reviewerName: names.get(x.reviewer_id) ?? "", at: x.created_at };
}

/** เติมข้อมูลประกอบ (รีวิว ธง คะแนน) ให้รายการวิ่งหลายรายการด้วย query ชุดเดียว */
async function hydrateRuns(db: SupabaseClient, rows: RunRow[]): Promise<Run[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [reviews, flags, ledger] = await Promise.all([
    db.from("run_reviews").select(REVIEW_COLUMNS).in("run_id", ids).order("created_at", { ascending: false }),
    db.from("run_flags").select("run_id, code").in("run_id", ids),
    db.from("point_ledger").select("run_id, points").in("run_id", ids),
  ]);
  const reviewRows = unwrap(reviews) as ReviewRow[];
  const flagRows = unwrap(flags) as { run_id: string; code: FlagCode }[];
  const ledgerRows = unwrap(ledger) as { run_id: string; points: number | string }[];
  const names = await displayNames(db, reviewRows.map((x) => x.reviewer_id));

  return rows.map((r) => {
    const latest = reviewRows.find((x) => x.run_id === r.id);
    const pointRows = ledgerRows.filter((l) => l.run_id === r.id);
    return {
      id: r.id,
      seasonId: r.season_id,
      runDate: r.run_date,
      distanceKm: num(r.distance_km),
      durationSeconds: r.duration_seconds,
      paceSecPerKm: r.pace_sec_per_km,
      note: r.note,
      status: r.status,
      points: pointRows.length ? Math.round(pointRows.reduce((s, l) => s + num(l.points) * 100, 0)) / 100 : null,
      submittedAt: r.submitted_at,
      decidedAt: r.decided_at,
      latestReview: latest ? mapReview(latest, names) : null,
      flagCodes: flagRows.filter((f) => f.run_id === r.id).map((f) => f.code),
    };
  });
}

export async function listMyRuns(
  auth: AuthContext,
  opts: { seasonId?: string; status?: RunStatus; cursor?: string; limit: number },
): Promise<Paged<Run>> {
  let q = auth.db
    .from("runs")
    .select(RUN_COLUMNS)
    .eq("user_id", auth.user.id)
    .order("run_date", { ascending: false })
    .order("submitted_at", { ascending: false })
    .limit(opts.limit + 1);
  if (opts.seasonId) q = q.eq("season_id", opts.seasonId);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.cursor) {
    const [date, at] = Buffer.from(opts.cursor, "base64url").toString().split("|");
    if (date && at) q = q.or(`run_date.lt.${date},and(run_date.eq.${date},submitted_at.lt."${at}")`);
  }
  const rows = unwrap(await q) as RunRow[];
  const page = rows.slice(0, opts.limit);
  const last = page.at(-1);
  return {
    items: await hydrateRuns(auth.db, page),
    nextCursor: rows.length > opts.limit && last ? Buffer.from(`${last.run_date}|${last.submitted_at}`).toString("base64url") : null,
  };
}

interface EvidenceRow {
  id: string;
  run_id: string;
  purge_after: string;
  purged_at: string | null;
}

/** รายละเอียดเต็ม (รูป ธง ประวัติรีวิว) — RLS จำกัดให้เจ้าของหรือผู้ตรวจ */
export async function getRunDetails(db: SupabaseClient, rows: RunRow[], includeEmployeeCode: boolean): Promise<RunDetail[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const [runs, evidence, flags, reviews, profiles] = await Promise.all([
    hydrateRuns(db, rows),
    db.from("evidence_files").select("id, run_id, purge_after, purged_at").in("run_id", ids).order("uploaded_at"),
    db.from("run_flags").select("run_id, code, detail").in("run_id", ids),
    db.from("run_reviews").select(REVIEW_COLUMNS).in("run_id", ids).order("created_at", { ascending: false }),
    db.from("profiles").select("id, display_name, employee_code").in("id", userIds),
  ]);
  const evidenceRows = unwrap(evidence) as EvidenceRow[];
  const flagRows = unwrap(flags) as { run_id: string; code: FlagCode; detail: Record<string, unknown> }[];
  const reviewRows = unwrap(reviews) as ReviewRow[];
  const profileRows = unwrap(profiles) as { id: string; display_name: string; employee_code: string }[];
  const names = await displayNames(db, reviewRows.map((x) => x.reviewer_id));

  return runs.map((run, i) => {
    const row = rows[i]!;
    const p = profileRows.find((x) => x.id === row.user_id);
    const ev: EvidenceRef[] = evidenceRows
      .filter((e) => e.run_id === run.id)
      .map((e) => ({
        id: e.id,
        url: e.purged_at ? null : `/api/v1/runs/${run.id}/evidence/${e.id}`,
        purged: e.purged_at !== null,
        purgeAfter: e.purge_after,
      }));
    return {
      ...run,
      runner: {
        id: row.user_id,
        displayName: p?.display_name ?? "",
        ...(includeEmployeeCode && p ? { employeeCode: p.employee_code } : {}),
      },
      evidence: ev,
      flags: flagRows.filter((f) => f.run_id === run.id).map((f) => ({ code: f.code, detail: f.detail })),
      reviews: reviewRows
        .filter((x) => x.run_id === run.id)
        .map((x) => mapReview(x, names)),
    };
  });
}

export async function getRunDetail(auth: AuthContext, runId: string): Promise<RunDetail> {
  const row = unwrap(await auth.db.from("runs").select(RUN_COLUMNS).eq("id", runId).maybeSingle()) as RunRow | null;
  if (!row) throw new AppError("NOT_FOUND", 404);
  const isReviewer = auth.user.roles.includes("approver") || auth.user.roles.includes("admin");
  const [detail] = await getRunDetails(auth.db, [row], isReviewer);
  return detail!;
}

/** เปิดรูปหลักฐาน: ตรวจสิทธิ์ผ่าน RLS ก่อน แล้วค่อยอ่านจาก R2 */
export async function getEvidenceFile(auth: AuthContext, runId: string, evidenceId: string): Promise<Response> {
  const row = unwrap(
    await auth.db.from("evidence_files").select("object_key, mime_type, purged_at").eq("id", evidenceId).eq("run_id", runId).maybeSingle(),
  ) as { object_key: string; mime_type: string; purged_at: string | null } | null;
  if (!row) throw new AppError("NOT_FOUND", 404);
  if (row.purged_at) throw new AppError("EVIDENCE_PURGED", 410);
  const obj = await evidenceBucket().get(row.object_key);
  if (!obj) throw new AppError("EVIDENCE_PURGED", 410);
  return new Response(obj.body, {
    headers: {
      "content-type": row.mime_type,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
}

export { RUN_COLUMNS };
