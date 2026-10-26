import { addDays, isValidIsoDate } from "./datetime";
import { fromCents, toCents } from "./decimal";
import { computePaceSecPerKm } from "./scoring";
import type { FlagCode, IsoDate, RunStatus, SeasonRules, SeasonStatus } from "./types";

/**
 * กฎข้อมูลผิดปกติ 2 ระดับ (ตรงกับ trigger ในฐานข้อมูล):
 *  - "ห้ามส่ง" (blocking)  → validateRunSubmission
 *  - "ติดธง"  (flag)      → computeFlags — ไม่ปฏิเสธอัตโนมัติ ให้ผู้ตรวจตัดสิน
 *
 * ฝั่งหน้าเว็บใช้เพื่อบอกผู้ใช้ทันที ส่วนฐานข้อมูลเป็นด่านสุดท้ายเสมอ
 */

export const MAX_DISTANCE_KM = 500;
export const MAX_DURATION_SECONDS = 172_800;

export type BlockingCode =
  | "INVALID_RUN_DATE"
  | "INVALID_DISTANCE"
  | "INVALID_DURATION"
  | "NO_ACTIVE_SEASON_FOR_DATE"
  | "NOT_A_PARTICIPANT"
  | "DISTANCE_BELOW_MIN"
  | "RUN_DATE_IN_FUTURE"
  | "RUN_DATE_TOO_OLD"
  | "EVIDENCE_REQUIRED"
  | "TOO_MANY_EVIDENCE_FILES";

export interface RuleViolation<C extends string = BlockingCode> {
  code: C;
  details?: Record<string, number | string>;
}

export interface RunInput {
  runDate: IsoDate;
  distanceKm: number;
  durationSeconds: number;
}

export interface SubmissionContext {
  rules: SeasonRules;
  /** วันนี้ตามเวลากรุงเทพฯ */
  today: IsoDate;
  /** ฤดูกาลที่เปิดอยู่ (null = ไม่มี) */
  season: { startDate: IsoDate; endDate: IsoDate; status: SeasonStatus } | null;
  isParticipant: boolean;
  evidenceCount: number;
}

/** คืนรายการข้อผิดพลาดทั้งหมด (ว่าง = ส่งได้) — แสดงทุกข้อในฟอร์มพร้อมกัน */
export function validateRunSubmission(run: RunInput, ctx: SubmissionContext): RuleViolation[] {
  const errors: RuleViolation[] = [];
  const { rules } = ctx;

  const dateOk = isValidIsoDate(run.runDate);
  if (!dateOk) errors.push({ code: "INVALID_RUN_DATE" });

  // ทศนิยมไม่เกิน 2 ตำแหน่ง (numeric(6,2) ในฐานข้อมูล)
  const distanceOk =
    Number.isFinite(run.distanceKm) &&
    run.distanceKm > 0 &&
    run.distanceKm <= MAX_DISTANCE_KM &&
    Math.abs(run.distanceKm * 100 - Math.round(run.distanceKm * 100)) < 1e-6;
  if (!distanceOk) {
    errors.push({ code: "INVALID_DISTANCE", details: { max: MAX_DISTANCE_KM } });
  } else if (toCents(run.distanceKm) < toCents(rules.minDistanceKm)) {
    errors.push({ code: "DISTANCE_BELOW_MIN", details: { min: rules.minDistanceKm } });
  }

  if (!Number.isInteger(run.durationSeconds) || run.durationSeconds < 1 || run.durationSeconds > MAX_DURATION_SECONDS) {
    errors.push({ code: "INVALID_DURATION" });
  }

  if (dateOk) {
    if (run.runDate > ctx.today) {
      errors.push({ code: "RUN_DATE_IN_FUTURE" });
    } else if (run.runDate < addDays(ctx.today, -rules.maxBackdateDays)) {
      errors.push({ code: "RUN_DATE_TOO_OLD", details: { max_days: rules.maxBackdateDays } });
    }

    const s = ctx.season;
    if (!s || s.status !== "active" || run.runDate < s.startDate || run.runDate > s.endDate) {
      errors.push({ code: "NO_ACTIVE_SEASON_FOR_DATE", details: { run_date: run.runDate } });
    } else if (!ctx.isParticipant) {
      errors.push({ code: "NOT_A_PARTICIPANT" });
    }
  }

  if (ctx.evidenceCount < 1) {
    errors.push({ code: "EVIDENCE_REQUIRED" });
  } else if (ctx.evidenceCount > rules.maxEvidenceFiles) {
    errors.push({ code: "TOO_MANY_EVIDENCE_FILES", details: { max: rules.maxEvidenceFiles } });
  }

  return errors;
}

/** รายการวิ่งอื่นของผู้ใช้คนเดียวกันในวันเดียวกัน (ใช้กฎรวมต่อวันและรายการซ้ำ) */
export interface SameDayRun {
  distanceKm: number;
  status: RunStatus;
}

export interface Flag {
  code: FlagCode;
  details: Record<string, number | string>;
}

const COUNTED_STATUSES: ReadonlySet<RunStatus> = new Set(["pending", "approved"]);

/**
 * ธงผิดปกติของรายการใหม่ — ตรงกับ public.runs_compute_flags()
 * (ธง duplicate_image ตรวจจาก hash ของรูปที่ฝั่ง server เท่านั้น)
 */
export function computeFlags(run: RunInput, rules: SeasonRules, sameDayOthers: readonly SameDayRun[] = []): Flag[] {
  const flags: Flag[] = [];
  const pace = computePaceSecPerKm(run.durationSeconds, run.distanceKm);

  if (rules.flagMinPaceSecPerKm !== null && pace < rules.flagMinPaceSecPerKm) {
    flags.push({ code: "pace_too_fast", details: { pace_sec_per_km: pace, threshold: rules.flagMinPaceSecPerKm } });
  }
  if (rules.flagMaxPaceSecPerKm !== null && pace > rules.flagMaxPaceSecPerKm) {
    flags.push({ code: "pace_too_slow", details: { pace_sec_per_km: pace, threshold: rules.flagMaxPaceSecPerKm } });
  }
  if (rules.flagMaxDistanceKm !== null && toCents(run.distanceKm) > toCents(rules.flagMaxDistanceKm)) {
    flags.push({ code: "distance_high", details: { distance_km: run.distanceKm, threshold: rules.flagMaxDistanceKm } });
  }

  const counted = sameDayOthers.filter((r) => COUNTED_STATUSES.has(r.status));
  const dailyCents = counted.reduce((sum, r) => sum + toCents(r.distanceKm), toCents(run.distanceKm));
  if (rules.flagMaxDailyKm !== null && dailyCents > toCents(rules.flagMaxDailyKm)) {
    flags.push({ code: "daily_total_high", details: { daily_km: fromCents(dailyCents), threshold: rules.flagMaxDailyKm } });
  }

  if (counted.some((r) => toCents(r.distanceKm) === toCents(run.distanceKm))) {
    flags.push({ code: "duplicate_entry", details: { run_date: run.runDate, distance_km: run.distanceKm } });
  }

  return flags;
}

/** วันที่เลือกได้ในฟอร์ม: [วันนี้ - N วัน, วันนี้] ตัดด้วยช่วงฤดูกาล */
export function allowedRunDateRange(
  today: IsoDate,
  rules: Pick<SeasonRules, "maxBackdateDays">,
  season: { startDate: IsoDate; endDate: IsoDate } | null,
): { min: IsoDate; max: IsoDate } | null {
  let min = addDays(today, -rules.maxBackdateDays);
  let max = today;
  if (season) {
    if (season.startDate > min) min = season.startDate;
    if (season.endDate < max) max = season.endDate;
  }
  return min <= max ? { min, max } : null;
}

/** pace ที่ใช้แสดงตัวอย่างในฟอร์มก่อนส่ง (null ถ้าข้อมูลยังไม่ครบ) */
export function previewPace(distanceKm: number, durationSeconds: number): number | null {
  if (!Number.isFinite(distanceKm) || toCents(distanceKm) <= 0) return null;
  if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) return null;
  return computePaceSecPerKm(durationSeconds, distanceKm);
}
