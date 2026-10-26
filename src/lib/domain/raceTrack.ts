import { toCents } from "./decimal";

/**
 * สนามแข่ง 5 อันดับแรก
 *  - ลู่ = อันดับ (ลู่ 0 = อันดับ 1) → เมื่ออันดับเปลี่ยน นักวิ่งสลับลู่
 *  - ระยะบนลู่ = คะแนน ÷ คะแนนผู้นำ (ผู้นำอยู่ที่เส้นชัยเสมอ)
 *  - ตั้งระยะขั้นต่ำไว้เล็กน้อย เพื่อให้นักวิ่งที่คะแนนน้อยมากยังมองเห็นบนลู่
 */

export const RACE_LANES = 5;

export interface RaceInput {
  userId: string;
  displayName: string;
  rank: number;
  totalPoints: number;
}

export interface RaceRunner extends RaceInput {
  lane: number;
  /** 0–1 ตำแหน่งบนลู่ */
  progress: number;
  isLeader: boolean;
  /** คะแนนที่ตามผู้นำ (0 สำหรับผู้นำ) */
  gapToLeader: number;
}

export function computeRace(
  standings: readonly RaceInput[],
  options: { lanes?: number; minProgress?: number } = {},
): RaceRunner[] {
  const lanes = options.lanes ?? RACE_LANES;
  const minProgress = options.minProgress ?? 0.04;
  const top = [...standings]
    .filter((s) => s.totalPoints > 0)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, lanes);
  const leader = top[0];
  if (!leader) return [];
  const leaderCents = toCents(leader.totalPoints);

  return top.map((s, lane) => {
    const ratio = toCents(s.totalPoints) / leaderCents;
    return {
      ...s,
      lane,
      progress: Math.min(1, Math.max(minProgress, ratio)),
      isLeader: lane === 0,
      gapToLeader: (leaderCents - toCents(s.totalPoints)) / 100,
    };
  });
}
