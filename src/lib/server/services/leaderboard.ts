import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gapToNextRank } from "@/lib/domain/ranking";
import type { Leaderboard, LeaderboardEntry, MyStats } from "@/lib/dto";
import { cachedJson } from "../cloudflare";
import { AppError, unwrap } from "../errors";
import { num } from "./seasons";

interface LeaderboardRow {
  season_id: string;
  user_id: string;
  display_name: string;
  department_code: string | null;
  department_name_th: string | null;
  department_name_en: string | null;
  total_points: number | string;
  total_distance_km: number | string;
  approved_run_count: number;
  reached_at: string;
  rank: number;
  previous_rank: number | null;
}

function mapEntry(r: LeaderboardRow): LeaderboardEntry {
  return {
    rank: r.rank,
    previousRank: r.previous_rank,
    userId: r.user_id,
    displayName: r.display_name,
    department: r.department_code
      ? { id: "", code: r.department_code, nameTh: r.department_name_th ?? "", nameEn: r.department_name_en ?? "" }
      : null,
    totalPoints: num(r.total_points),
    totalDistanceKm: num(r.total_distance_km),
    approvedRunCount: r.approved_run_count,
    reachedAt: r.reached_at,
  };
}

export async function getLeaderboardVersion(db: SupabaseClient, seasonId: string): Promise<number> {
  return cachedJson(`lb-version/${seasonId}`, 5, async () => {
    const row = unwrap(
      await db.from("seasons").select("leaderboard_version").eq("id", seasonId).maybeSingle(),
    ) as { leaderboard_version: number } | null;
    if (!row) throw new AppError("NOT_FOUND", 404);
    return Number(row.leaderboard_version);
  });
}

async function loadLeaderboard(db: SupabaseClient, seasonId: string): Promise<Leaderboard> {
  const [season, entries, roster] = await Promise.all([
    db.from("seasons").select("leaderboard_version").eq("id", seasonId).maybeSingle(),
    db.from("leaderboard").select("*").eq("season_id", seasonId).order("rank"),
    db.from("season_roster").select("user_id, display_name").eq("season_id", seasonId).order("display_name"),
  ]);
  const s = unwrap(season) as { leaderboard_version: number } | null;
  if (!s) throw new AppError("NOT_FOUND", 404);
  const mapped = (unwrap(entries) as LeaderboardRow[]).map(mapEntry);
  const ranked = new Set(mapped.map((e) => e.userId));
  const unranked = (unwrap(roster) as { user_id: string; display_name: string }[])
    .filter((r) => !ranked.has(r.user_id))
    .map((r) => ({ userId: r.user_id, displayName: r.display_name }));
  return { seasonId, version: Number(s.leaderboard_version), generatedAt: new Date().toISOString(), entries: mapped, unranked };
}

/**
 * ตารางคะแนนทั้งหมด — cache ตามเวอร์ชันปัจจุบันของฤดูกาล (ทุกผู้ชมได้ข้อมูลเดียวกัน)
 * ใช้เวอร์ชันจากฐานข้อมูลเป็น key เสมอ ไม่ใช้ค่า v ที่ client ส่งมา (กันการวาง cache ล่วงหน้า)
 */
export async function getLeaderboard(db: SupabaseClient, seasonId: string): Promise<Leaderboard> {
  const version = await getLeaderboardVersion(db, seasonId);
  return cachedJson(`lb/${seasonId}/${version}`, 3600, () => loadLeaderboard(db, seasonId));
}

export async function getMyStats(db: SupabaseClient, seasonId: string, userId: string): Promise<MyStats> {
  const [lb, pending, roster] = await Promise.all([
    db.from("leaderboard_entries").select("user_id, rank, previous_rank, total_points, total_distance_km, approved_run_count").eq("season_id", seasonId),
    db.from("runs").select("distance_km").eq("season_id", seasonId).eq("user_id", userId).eq("status", "pending"),
    db.from("season_roster").select("user_id", { count: "exact", head: true }).eq("season_id", seasonId),
  ]);
  const rows = (unwrap(lb) as Array<{
    user_id: string;
    rank: number;
    previous_rank: number | null;
    total_points: number | string;
    total_distance_km: number | string;
    approved_run_count: number;
  }>).map((r) => ({ ...r, userId: r.user_id, totalPoints: num(r.total_points) }));
  const me = rows.find((r) => r.user_id === userId);
  const pendingRows = unwrap(pending) as { distance_km: number | string }[];
  if (roster.error) unwrap(roster);

  return {
    seasonId,
    rank: me?.rank ?? null,
    previousRank: me?.previous_rank ?? null,
    totalPoints: me ? num(me.total_points) : 0,
    totalDistanceKm: me ? num(me.total_distance_km) : 0,
    approvedRunCount: me?.approved_run_count ?? 0,
    pendingRunCount: pendingRows.length,
    pendingDistanceKm: Math.round(pendingRows.reduce((s, r) => s + num(r.distance_km) * 100, 0)) / 100,
    participantCount: roster.count ?? 0,
    pointsToNextRank: gapToNextRank(rows, userId),
  };
}
