/** ชนิดข้อมูลกลางของโดเมน — ตรงกับ enum ในฐานข้อมูล (supabase/migrations) */

export type Role = "runner" | "approver" | "admin";
export type SeasonStatus = "draft" | "active" | "closed";
export type RunStatus = "pending" | "approved" | "rejected" | "cancelled" | "revoked";
export type FlagCode =
  | "pace_too_fast"
  | "pace_too_slow"
  | "distance_high"
  | "daily_total_high"
  | "duplicate_entry"
  | "duplicate_image";
export type LedgerEntryType = "run_approved" | "run_revoked" | "manual_adjustment" | "rule_recalc";

/** กติกาของฤดูกาล (season_rules) — null ในเกณฑ์ติดธง = ปิดกฎนั้น */
export interface SeasonRules {
  pointsPerKm: number;
  minDistanceKm: number;
  maxBackdateDays: number;
  maxEvidenceFiles: number;
  flagMinPaceSecPerKm: number | null;
  flagMaxPaceSecPerKm: number | null;
  flagMaxDistanceKm: number | null;
  flagMaxDailyKm: number | null;
}

/** ค่าเริ่มต้นเดียวกับ default ของคอลัมน์ใน season_rules */
export const DEFAULT_RULES: SeasonRules = {
  pointsPerKm: 10,
  minDistanceKm: 0.1,
  maxBackdateDays: 7,
  maxEvidenceFiles: 3,
  flagMinPaceSecPerKm: 180,
  flagMaxPaceSecPerKm: 1200,
  flagMaxDistanceKm: 42.2,
  flagMaxDailyKm: 50,
};

/** วันที่ตามปฏิทิน รูปแบบ YYYY-MM-DD (ค.ศ.) */
export type IsoDate = string;
