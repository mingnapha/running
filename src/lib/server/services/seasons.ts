import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentSeason, Season, SeasonRulesDto } from "@/lib/dto";
import { unwrap } from "../errors";

export interface SeasonRow {
  id: string;
  name_th: string;
  name_en: string;
  start_date: string;
  end_date: string;
  status: Season["status"];
  leaderboard_version: number;
  closed_at: string | null;
}

export interface RulesRow {
  id: string;
  season_id: string;
  version: number;
  points_per_km: number | string;
  min_distance_km: number | string;
  max_backdate_days: number;
  max_evidence_files: number;
  flag_min_pace_sec_per_km: number | null;
  flag_max_pace_sec_per_km: number | null;
  flag_max_distance_km: number | string | null;
  flag_max_daily_km: number | string | null;
  change_reason: string;
  created_at: string;
}

export const SEASON_COLUMNS = "id, name_th, name_en, start_date, end_date, status, leaderboard_version, closed_at";

/** numeric ของ Postgres มาเป็น string หรือ number แล้วแต่ขนาด — แปลงเป็น number เสมอ */
export const num = (v: number | string): number => (typeof v === "number" ? v : Number(v));
const numOrNull = (v: number | string | null): number | null => (v === null ? null : num(v));

export function mapSeason(r: SeasonRow): Season {
  return {
    id: r.id,
    nameTh: r.name_th,
    nameEn: r.name_en,
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status,
    leaderboardVersion: Number(r.leaderboard_version),
    closedAt: r.closed_at,
  };
}

export function mapRules(r: RulesRow): SeasonRulesDto {
  return {
    id: r.id,
    seasonId: r.season_id,
    version: r.version,
    pointsPerKm: num(r.points_per_km),
    minDistanceKm: num(r.min_distance_km),
    maxBackdateDays: r.max_backdate_days,
    maxEvidenceFiles: r.max_evidence_files,
    flagMinPaceSecPerKm: r.flag_min_pace_sec_per_km,
    flagMaxPaceSecPerKm: r.flag_max_pace_sec_per_km,
    flagMaxDistanceKm: numOrNull(r.flag_max_distance_km),
    flagMaxDailyKm: numOrNull(r.flag_max_daily_km),
    changeReason: r.change_reason,
    createdAt: r.created_at,
  };
}

export async function listSeasons(db: SupabaseClient): Promise<Season[]> {
  const rows = unwrap(
    await db.from("seasons").select(SEASON_COLUMNS).is("deleted_at", null).order("start_date", { ascending: false }),
  ) as SeasonRow[];
  return rows.map(mapSeason);
}

export async function getSeason(db: SupabaseClient, seasonId: string): Promise<Season | null> {
  const row = unwrap(await db.from("seasons").select(SEASON_COLUMNS).eq("id", seasonId).maybeSingle()) as SeasonRow | null;
  return row ? mapSeason(row) : null;
}

export async function getCurrentRules(db: SupabaseClient, seasonId: string): Promise<SeasonRulesDto> {
  const row = unwrap(
    await db.from("season_rules").select("*").eq("season_id", seasonId).order("version", { ascending: false }).limit(1).single(),
  ) as RulesRow;
  return mapRules(row);
}

export async function listRules(db: SupabaseClient, seasonId: string): Promise<SeasonRulesDto[]> {
  const rows = unwrap(
    await db.from("season_rules").select("*").eq("season_id", seasonId).order("version", { ascending: false }),
  ) as RulesRow[];
  return rows.map(mapRules);
}

/** ฤดูกาลที่เปิดอยู่ (ถ้าไม่มี ใช้ฤดูกาลล่าสุดที่ปิดแล้ว เพื่อให้หน้าหลักยังแสดงผลสุดท้ายได้) */
export async function getCurrentSeason(db: SupabaseClient, userId: string): Promise<CurrentSeason | null> {
  const rows = unwrap(
    await db
      .from("seasons")
      .select(SEASON_COLUMNS)
      .is("deleted_at", null)
      .in("status", ["active", "closed"])
      .order("status", { ascending: true }) // 'active' < 'closed' ตามลำดับ enum
      .order("start_date", { ascending: false })
      .limit(1),
  ) as SeasonRow[];
  const row = rows[0];
  if (!row) return null;

  const [rules, participant] = await Promise.all([
    getCurrentRules(db, row.id),
    db.from("season_participants").select("user_id").eq("season_id", row.id).eq("user_id", userId).is("removed_at", null).maybeSingle(),
  ]);
  return { season: mapSeason(row), rules, isParticipant: unwrap(participant) !== null };
}
