/**
 * เทียบตารางคะแนนเวอร์ชันเก่ากับใหม่ (ฝั่งหน้าเว็บ) เพื่อเล่นแอนิเมชัน:
 *  แถวเลื่อน, ตัวเลขนับขึ้น, ไฮไลต์คนที่คะแนนเปลี่ยน
 */

export interface DiffEntry {
  userId: string;
  rank: number;
  totalPoints: number;
}

export interface EntryChange {
  userId: string;
  fromRank: number | null;
  toRank: number;
  fromPoints: number;
  toPoints: number;
  /** บวก = ขึ้น */
  rankDelta: number;
  pointsChanged: boolean;
}

export function diffLeaderboards(prev: readonly DiffEntry[], next: readonly DiffEntry[]): Map<string, EntryChange> {
  const before = new Map(prev.map((e) => [e.userId, e]));
  const changes = new Map<string, EntryChange>();
  for (const e of next) {
    const old = before.get(e.userId);
    changes.set(e.userId, {
      userId: e.userId,
      fromRank: old?.rank ?? null,
      toRank: e.rank,
      fromPoints: old?.totalPoints ?? 0,
      toPoints: e.totalPoints,
      rankDelta: old ? old.rank - e.rank : 0,
      pointsChanged: !old || old.totalPoints !== e.totalPoints,
    });
  }
  return changes;
}

/** ค่าระหว่างทางของตัวเลขที่ "นับขึ้น" (ease-out) — t ∈ [0, 1] */
export function countUpValue(from: number, to: number, t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const eased = 1 - (1 - clamped) ** 3;
  return Math.round((from + (to - from) * eased) * 100) / 100;
}
