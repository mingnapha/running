import { describe, expect, it } from "vitest";
import {
  carryPreviousRank,
  computeStandings,
  gapToNextRank,
  rankEntries,
  rankMovement,
  type LedgerRow,
} from "./ranking";

let nextId = 1;
const approved = (userId: string, runId: string, km: number, submittedAt: string, rate = 10): LedgerRow => ({
  id: nextId++,
  userId,
  runId,
  points: Math.round(km * rate * 100) / 100,
  distanceKm: km,
  effectiveAt: submittedAt,
});
const revoked = (row: LedgerRow): LedgerRow => ({
  ...row,
  id: nextId++,
  points: -row.points,
  distanceKm: -row.distanceKm,
});
const manual = (userId: string, points: number, at: string): LedgerRow => ({
  id: nextId++,
  userId,
  runId: null,
  points,
  distanceKm: 0,
  effectiveAt: at,
});

describe("computeStandings — ตรงกับผลในฐานข้อมูล (seed ฤดูกาล 2/2569)", () => {
  const emp001Revoked = approved("EMP001", "r1d", 4.0, "2026-10-10T12:30:00Z");
  const ledger: LedgerRow[] = [
    approved("EMP001", "r1a", 5.0, "2026-10-02T11:30:00Z"),
    approved("EMP001", "r1b", 3.0, "2026-10-10T12:05:00Z"),
    approved("EMP001", "r1c", 6.2, "2026-10-15T11:40:00Z"),
    emp001Revoked,
    revoked(emp001Revoked),
    approved("EMP002", "r2a", 10.0, "2026-10-03T00:20:00Z"),
    approved("EMP002", "r2b", 5.5, "2026-10-12T23:55:00Z"),
    approved("EMP003", "r3a", 4.0, "2026-10-06T11:10:00Z"),
    approved("EMP003", "r3b", 4.0, "2026-10-14T11:15:00Z"),
    approved("EMP004", "r4a", 7.0, "2026-10-05T01:00:00Z"),
    approved("EMP004", "r4b", 1.0, "2026-10-11T10:30:00Z"),
    approved("EMP005", "r5a", 12.0, "2026-10-08T23:00:00Z"),
    approved("EMP006", "r6a", 2.5, "2026-10-04T12:00:00Z"),
    approved("EMP006", "r6b", 2.5, "2026-10-13T12:10:00Z"),
    manual("EMP006", 5, "2026-10-21T13:02:27Z"),
    approved("EMP007", "r7a", 9.0, "2026-10-09T10:50:00Z"),
    approved("EMP010", "r10a", 6.0, "2026-10-07T11:25:00Z"),
  ];
  const standings = computeStandings(ledger);

  it("ลำดับ คะแนน และระยะ ตรงกับฐานข้อมูล", () => {
    expect(standings.map((s) => [s.rank, s.userId, s.totalPoints, s.totalDistanceKm])).toEqual([
      [1, "EMP002", 155, 15.5],
      [2, "EMP001", 142, 14.2],
      [3, "EMP005", 120, 12],
      [4, "EMP007", 90, 9],
      [5, "EMP004", 80, 8],
      [6, "EMP003", 80, 8],
      [7, "EMP010", 60, 6],
      [8, "EMP006", 55, 5],
    ]);
  });

  it("คะแนนเท่ากัน: ผู้ที่ถึงคะแนนนั้นก่อนได้อันดับดีกว่า (ณัฐชา 11 ต.ค. ก่อน วิทยา 14 ต.ค.)", () => {
    const [a, b] = [standings.find((s) => s.userId === "EMP004")!, standings.find((s) => s.userId === "EMP003")!];
    expect(a.totalPoints).toBe(b.totalPoints);
    expect(a.reachedAt).toBe("2026-10-11T10:30:00.000Z");
    expect(b.reachedAt).toBe("2026-10-14T11:15:00.000Z");
    expect(a.rank).toBeLessThan(b.rank);
  });

  it("รายการที่ถูกเพิกถอนไม่นับเป็นเวลาถึงคะแนน", () => {
    expect(standings.find((s) => s.userId === "EMP001")!.reachedAt).toBe("2026-10-15T11:40:00.000Z");
  });

  it("การปรับคะแนนด้วยมือใช้เวลาที่ปรับ", () => {
    expect(standings.find((s) => s.userId === "EMP006")!.reachedAt).toBe("2026-10-21T13:02:27.000Z");
  });
});

describe("computeStandings — กรณีพิเศษ", () => {
  it("ใช้เวลาส่งบันทึก ไม่ใช่ลำดับการอนุมัติ", () => {
    // A ส่งก่อน B แต่ผู้ตรวจอนุมัติของ B ก่อน (ลำดับใน ledger) → A ยังชนะเมื่อคะแนนเท่ากัน
    const ledger = [
      approved("B", "rb", 5, "2026-10-10T09:00:00Z"),
      approved("A", "ra", 5, "2026-10-10T08:00:00Z"),
    ];
    expect(computeStandings(ledger).map((s) => s.userId)).toEqual(["A", "B"]);
  });

  it("อนุมัติไม่เรียงลำดับ: เวลาถึงคะแนน = รายการที่ส่งล่าสุด", () => {
    const ledger = [approved("A", "r2", 3, "2026-10-12T00:00:00Z"), approved("A", "r1", 3, "2026-10-10T00:00:00Z")];
    expect(computeStandings(ledger)[0]!.reachedAt).toBe("2026-10-12T00:00:00.000Z");
  });

  it("เวลาเท่ากันทุกอย่าง ตัดสินด้วย userId (ผลคงที่)", () => {
    const at = "2026-10-10T00:00:00Z";
    expect(computeStandings([approved("Z", "rz", 5, at), approved("M", "rm", 5, at)]).map((s) => s.userId)).toEqual(["M", "Z"]);
  });

  it("คะแนนรวม 0 หรือติดลบไม่อยู่ในตาราง", () => {
    const r = approved("A", "ra", 5, "2026-10-10T00:00:00Z");
    const ledger = [r, revoked(r), approved("B", "rb", 1, "2026-10-10T00:00:00Z"), manual("C", -5, "2026-10-11T00:00:00Z")];
    expect(computeStandings(ledger).map((s) => s.userId)).toEqual(["B"]);
  });

  it("คำนวณย้อนหลังเมื่อเปลี่ยนกติกา (rule_recalc ผูกกับรายการเดิม)", () => {
    const r = approved("A", "ra", 5, "2026-10-10T00:00:00Z"); // 50
    const recalc: LedgerRow = { id: nextId++, userId: "A", runId: "ra", points: 10, distanceKm: 0, effectiveAt: "2026-10-10T00:00:00Z" };
    const [a] = computeStandings([r, recalc]);
    expect(a).toMatchObject({ totalPoints: 60, totalDistanceKm: 5, reachedAt: "2026-10-10T00:00:00.000Z" });
  });

  it("ผลรวมทศนิยมไม่คลาดเคลื่อน", () => {
    const ledger = [approved("A", "r1", 0.1, "2026-10-10T00:00:00Z", 1), approved("A", "r2", 0.2, "2026-10-11T00:00:00Z", 1)];
    expect(computeStandings(ledger)[0]).toMatchObject({ totalPoints: 0.3, totalDistanceKm: 0.3 });
  });

  it("ไม่มีข้อมูล = ตารางว่าง", () => {
    expect(computeStandings([])).toEqual([]);
  });
});

describe("rankEntries", () => {
  it("ไม่แก้ลำดับของ input เดิม", () => {
    const input = [
      { userId: "a", totalPoints: 1, reachedAt: "2026-10-01T00:00:00Z" },
      { userId: "b", totalPoints: 2, reachedAt: "2026-10-01T00:00:00Z" },
    ];
    expect(rankEntries(input).map((e) => [e.userId, e.rank])).toEqual([
      ["b", 1],
      ["a", 2],
    ]);
    expect(input[0]!.userId).toBe("a");
  });
});

describe("rankMovement — ป้าย ▲/▼", () => {
  it.each([
    [3, 5, { kind: "up", by: 2 }],
    [5, 3, { kind: "down", by: 2 }],
    [4, 4, { kind: "same" }],
    [7, null, { kind: "new" }],
  ])("อันดับ %d (เดิม %s)", (rank, prev, expected) => {
    expect(rankMovement(rank, prev)).toEqual(expected);
  });
});

describe("carryPreviousRank", () => {
  it("อันดับเปลี่ยน → previousRank = อันดับเดิม", () => {
    expect(carryPreviousRank({ rank: 4, previousRank: 6 }, 2)).toBe(4);
  });
  it("อันดับไม่เปลี่ยน → คงป้ายเดิมไว้", () => {
    expect(carryPreviousRank({ rank: 4, previousRank: 6 }, 4)).toBe(6);
  });
  it("เพิ่งเข้าตาราง → null", () => {
    expect(carryPreviousRank(undefined, 3)).toBeNull();
  });
});

describe("gapToNextRank", () => {
  const s = [
    { userId: "a", rank: 1, totalPoints: 155 },
    { userId: "b", rank: 2, totalPoints: 142 },
    { userId: "c", rank: 3, totalPoints: 142 },
  ];
  it("ระยะห่างจากอันดับก่อนหน้า", () => {
    expect(gapToNextRank(s, "b")).toBe(13);
    expect(gapToNextRank(s, "c")).toBe(0);
  });
  it("ผู้นำ หรือ ยังไม่มีคะแนน → null", () => {
    expect(gapToNextRank(s, "a")).toBeNull();
    expect(gapToNextRank(s, "zzz")).toBeNull();
  });
});
