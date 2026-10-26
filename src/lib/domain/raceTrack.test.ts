import { describe, expect, it } from "vitest";
import { computeRace } from "./raceTrack";
import { countUpValue, diffLeaderboards } from "./leaderboardDiff";

const entry = (userId: string, rank: number, totalPoints: number) => ({ userId, displayName: userId, rank, totalPoints });

describe("computeRace — สนามแข่ง 5 อันดับแรก", () => {
  const standings = [
    entry("e", 5, 80),
    entry("a", 1, 155),
    entry("b", 2, 142),
    entry("c", 3, 120),
    entry("d", 4, 90),
    entry("f", 6, 60),
  ];
  const race = computeRace(standings);

  it("แสดงแค่ 5 อันดับแรก เรียงลู่ตามอันดับ", () => {
    expect(race.map((r) => [r.lane, r.userId])).toEqual([
      [0, "a"],
      [1, "b"],
      [2, "c"],
      [3, "d"],
      [4, "e"],
    ]);
  });

  it("ผู้นำอยู่เส้นชัย คนอื่นวิ่งตามสัดส่วนคะแนนเทียบผู้นำ", () => {
    expect(race[0]).toMatchObject({ progress: 1, isLeader: true, gapToLeader: 0 });
    expect(race[1]!.progress).toBeCloseTo(142 / 155, 10);
    expect(race[4]).toMatchObject({ isLeader: false, gapToLeader: 75 });
  });

  it("อันดับเปลี่ยน → สลับลู่", () => {
    const after = computeRace([entry("a", 2, 155), entry("b", 1, 170)]);
    expect(after.map((r) => [r.userId, r.lane])).toEqual([
      ["b", 0],
      ["a", 1],
    ]);
  });

  it("คะแนนน้อยมากยังเห็นบนลู่ (ระยะขั้นต่ำ)", () => {
    const r = computeRace([entry("a", 1, 1000), entry("b", 2, 1)]);
    expect(r[1]!.progress).toBe(0.04);
  });

  it("คะแนนเท่าผู้นำ อยู่เส้นชัยเหมือนกันแต่ไม่ใช่ผู้นำ", () => {
    const r = computeRace([entry("a", 1, 80), entry("b", 2, 80)]);
    expect(r.map((x) => [x.progress, x.isLeader])).toEqual([
      [1, true],
      [1, false],
    ]);
  });

  it("ยังไม่มีใครมีคะแนน → สนามว่าง", () => {
    expect(computeRace([])).toEqual([]);
    expect(computeRace([entry("a", 1, 0)])).toEqual([]);
  });

  it("ปรับจำนวนลู่ได้", () => {
    expect(computeRace(standings, { lanes: 3 })).toHaveLength(3);
  });
});

describe("diffLeaderboards — ข้อมูลสำหรับแอนิเมชัน", () => {
  it("บอกการขยับอันดับและคะแนนที่เปลี่ยน", () => {
    const prev = [
      { userId: "a", rank: 1, totalPoints: 155 },
      { userId: "b", rank: 2, totalPoints: 142 },
    ];
    const next = [
      { userId: "b", rank: 1, totalPoints: 192 },
      { userId: "a", rank: 2, totalPoints: 155 },
      { userId: "c", rank: 3, totalPoints: 10 },
    ];
    const d = diffLeaderboards(prev, next);
    expect(d.get("b")).toMatchObject({ fromRank: 2, toRank: 1, rankDelta: 1, fromPoints: 142, toPoints: 192, pointsChanged: true });
    expect(d.get("a")).toMatchObject({ rankDelta: -1, pointsChanged: false });
    expect(d.get("c")).toMatchObject({ fromRank: null, rankDelta: 0, fromPoints: 0, pointsChanged: true });
  });
});

describe("countUpValue — ตัวเลขนับขึ้น", () => {
  it("เริ่มที่ค่าเดิม จบที่ค่าใหม่", () => {
    expect(countUpValue(100, 130, 0)).toBe(100);
    expect(countUpValue(100, 130, 1)).toBe(130);
    expect(countUpValue(100, 130, 2)).toBe(130);
  });
  it("ease-out: ครึ่งทางเวลา เกินครึ่งทางค่า", () => {
    expect(countUpValue(0, 100, 0.5)).toBeGreaterThan(50);
  });
});
