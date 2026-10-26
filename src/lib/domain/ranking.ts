import { fromCents, toCents } from "./decimal";

/**
 * การจัดอันดับ — ตรงกับ public.refresh_leaderboard()
 *
 *   เรียง: คะแนนมาก → น้อย, ถึงคะแนนนั้นก่อน (reachedAt) → ได้อันดับดีกว่า, userId (ให้ผลคงที่)
 *   reachedAt = เวลาล่าสุดของ "แหล่งคะแนน" ที่ยังมีผล
 *     - รายการวิ่ง: เวลาที่ส่งบันทึก (submitted_at) ไม่ใช่เวลาอนุมัติ
 *     - ปรับมือ: เวลาที่ปรับ
 *   รายการที่ถูกเพิกถอนจนคะแนนสุทธิ = 0 ไม่นับใน reachedAt
 *   ผู้ที่คะแนนรวม ≤ 0 ไม่อยู่ในตาราง (แสดงเป็น "—")
 */

export interface LedgerRow {
  id: number;
  userId: string;
  runId: string | null;
  points: number;
  distanceKm: number;
  /** เวลาที่ใช้ตัดสินอันดับเท่ากัน (ISO-8601) */
  effectiveAt: string;
}

export interface Standing {
  userId: string;
  totalPoints: number;
  totalDistanceKm: number;
  reachedAt: string;
  rank: number;
}

export interface RankableEntry {
  userId: string;
  totalPoints: number;
  reachedAt: string;
}

export function compareStandings(a: RankableEntry, b: RankableEntry): number {
  const byPoints = toCents(b.totalPoints) - toCents(a.totalPoints);
  if (byPoints !== 0) return byPoints;
  const byReached = Date.parse(a.reachedAt) - Date.parse(b.reachedAt);
  if (byReached !== 0) return byReached;
  return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
}

/** เรียงและใส่อันดับ (1, 2, 3, … ไม่มีอันดับซ้ำเพราะมีตัวตัดสินเสมอ) */
export function rankEntries<T extends RankableEntry>(entries: readonly T[]): Array<T & { rank: number }> {
  return [...entries].sort(compareStandings).map((e, i) => ({ ...e, rank: i + 1 }));
}

/** คำนวณตารางคะแนนจากสมุดคะแนน (ledger) */
export function computeStandings(ledger: readonly LedgerRow[]): Standing[] {
  interface Source {
    userId: string;
    cents: number;
    distanceCents: number;
    effectiveAt: number;
  }
  const sources = new Map<string, Source>();
  for (const row of ledger) {
    const key = `${row.userId}|${row.runId ?? `adj:${row.id}`}`;
    const at = Date.parse(row.effectiveAt);
    if (Number.isNaN(at)) throw new RangeError(`Invalid effectiveAt on ledger row ${row.id}`);
    const s = sources.get(key);
    if (s) {
      s.cents += toCents(row.points);
      s.distanceCents += toCents(row.distanceKm);
      s.effectiveAt = Math.min(s.effectiveAt, at);
    } else {
      sources.set(key, {
        userId: row.userId,
        cents: toCents(row.points),
        distanceCents: toCents(row.distanceKm),
        effectiveAt: at,
      });
    }
  }

  const totals = new Map<string, { cents: number; distanceCents: number; reachedAt: number }>();
  for (const s of sources.values()) {
    const t = totals.get(s.userId) ?? { cents: 0, distanceCents: 0, reachedAt: Number.NEGATIVE_INFINITY };
    t.cents += s.cents;
    t.distanceCents += s.distanceCents;
    if (s.cents !== 0) t.reachedAt = Math.max(t.reachedAt, s.effectiveAt);
    totals.set(s.userId, t);
  }

  const entries: Array<RankableEntry & { totalDistanceKm: number }> = [];
  for (const [userId, t] of totals) {
    if (t.cents <= 0) continue;
    entries.push({
      userId,
      totalPoints: fromCents(t.cents),
      totalDistanceKm: fromCents(t.distanceCents),
      reachedAt: new Date(t.reachedAt).toISOString(),
    });
  }
  return rankEntries(entries);
}

/**
 * previousRank เปลี่ยนเฉพาะเมื่ออันดับเปลี่ยน เพื่อให้ป้าย ▲/▼ คงอยู่จนกว่าจะเปลี่ยนอีกครั้ง
 * (เหมือนเงื่อนไข ON CONFLICT ใน refresh_leaderboard)
 */
export function carryPreviousRank(
  oldEntry: { rank: number; previousRank: number | null } | undefined,
  newRank: number,
): number | null {
  if (!oldEntry) return null;
  return oldEntry.rank !== newRank ? oldEntry.rank : oldEntry.previousRank;
}

export type Movement =
  | { kind: "up"; by: number }
  | { kind: "down"; by: number }
  | { kind: "same" }
  | { kind: "new" };

/** ป้ายการเปลี่ยนอันดับ: "▲ ขึ้น N อันดับ" / "▼ ลง N อันดับ" (สีเทา) / ใหม่ */
export function rankMovement(rank: number, previousRank: number | null | undefined): Movement {
  if (previousRank == null) return { kind: "new" };
  if (previousRank > rank) return { kind: "up", by: previousRank - rank };
  if (previousRank < rank) return { kind: "down", by: rank - previousRank };
  return { kind: "same" };
}

/**
 * ระยะห่างจากอันดับถัดไป (คะแนน) — null ถ้าเป็นผู้นำหรือยังไม่มีคะแนน
 * คะแนนเท่ากันแต่ถึงทีหลัง = ห่าง 0 (ต้องได้เพิ่มอีกเล็กน้อยก็แซงได้)
 */
export function gapToNextRank(
  standings: readonly { userId: string; rank: number; totalPoints: number }[],
  userId: string,
): number | null {
  const me = standings.find((s) => s.userId === userId);
  if (!me || me.rank === 1) return null;
  const ahead = standings.find((s) => s.rank === me.rank - 1);
  if (!ahead) return null;
  return fromCents(toCents(ahead.totalPoints) - toCents(me.totalPoints));
}
