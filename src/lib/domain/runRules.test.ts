import { describe, expect, it } from "vitest";
import { allowedRunDateRange, computeFlags, previewPace, validateRunSubmission, type SubmissionContext } from "./runRules";
import { DEFAULT_RULES, type SeasonRules } from "./types";

const TODAY = "2026-10-21";
const ctx = (over: Partial<SubmissionContext> = {}): SubmissionContext => ({
  rules: DEFAULT_RULES,
  today: TODAY,
  season: { startDate: "2026-10-01", endDate: "2026-12-31", status: "active" },
  isParticipant: true,
  evidenceCount: 1,
  ...over,
});
const run = (over: Partial<{ runDate: string; distanceKm: number; durationSeconds: number }> = {}) => ({
  runDate: TODAY,
  distanceKm: 5,
  durationSeconds: 1800,
  ...over,
});
const codes = (r: ReturnType<typeof validateRunSubmission>) => r.map((e) => e.code);

describe("validateRunSubmission — กฎห้ามส่ง", () => {
  it("รายการปกติส่งได้", () => {
    expect(validateRunSubmission(run(), ctx())).toEqual([]);
  });

  describe("วันที่", () => {
    it("ห้ามบันทึกวันที่ในอนาคต", () => {
      expect(codes(validateRunSubmission(run({ runDate: "2026-10-22" }), ctx()))).toEqual(["RUN_DATE_IN_FUTURE"]);
    });

    it("ห้ามบันทึกย้อนหลังเกิน 7 วัน", () => {
      const r = validateRunSubmission(run({ runDate: "2026-10-13" }), ctx());
      expect(r).toEqual([{ code: "RUN_DATE_TOO_OLD", details: { max_days: 7 } }]);
    });

    it("ย้อนหลังพอดี 7 วันยังส่งได้ (ขอบเขต)", () => {
      expect(validateRunSubmission(run({ runDate: "2026-10-14" }), ctx())).toEqual([]);
    });

    it("จำนวนวันย้อนหลังตั้งได้ต่อฤดูกาล", () => {
      const rules: SeasonRules = { ...DEFAULT_RULES, maxBackdateDays: 3 };
      expect(codes(validateRunSubmission(run({ runDate: "2026-10-17" }), ctx({ rules })))).toEqual(["RUN_DATE_TOO_OLD"]);
      expect(validateRunSubmission(run({ runDate: "2026-10-18" }), ctx({ rules }))).toEqual([]);
    });

    it("ข้ามเดือน/ปีได้ถูกต้อง", () => {
      const c = ctx({ today: "2027-01-03", season: { startDate: "2026-12-01", endDate: "2027-02-28", status: "active" } });
      expect(validateRunSubmission(run({ runDate: "2026-12-27" }), c)).toEqual([]);
      expect(codes(validateRunSubmission(run({ runDate: "2026-12-26" }), c))).toEqual(["RUN_DATE_TOO_OLD"]);
    });

    it("วันที่ไม่ถูกต้อง", () => {
      expect(codes(validateRunSubmission(run({ runDate: "2026-02-30" }), ctx()))).toEqual(["INVALID_RUN_DATE"]);
      expect(codes(validateRunSubmission(run({ runDate: "21/10/2569" }), ctx()))).toEqual(["INVALID_RUN_DATE"]);
    });
  });

  describe("ระยะทาง", () => {
    it("ระยะขั้นต่ำ 0.1 กม.", () => {
      expect(validateRunSubmission(run({ distanceKm: 0.09 }), ctx())).toEqual([
        { code: "DISTANCE_BELOW_MIN", details: { min: 0.1 } },
      ]);
      expect(validateRunSubmission(run({ distanceKm: 0.1, durationSeconds: 60 }), ctx())).toEqual([]);
    });

    it("ระยะขั้นต่ำตั้งได้", () => {
      const rules = { ...DEFAULT_RULES, minDistanceKm: 1 };
      expect(codes(validateRunSubmission(run({ distanceKm: 0.99 }), ctx({ rules })))).toEqual(["DISTANCE_BELOW_MIN"]);
    });

    it.each([0, -3, 500.01, Number.NaN, Number.POSITIVE_INFINITY, 1.234])("ระยะ %d ไม่ถูกต้อง", (distanceKm) => {
      expect(codes(validateRunSubmission(run({ distanceKm }), ctx()))).toEqual(["INVALID_DISTANCE"]);
    });

    it("ทศนิยม 2 ตำแหน่งที่เป็น floating point ได้ (เช่น 0.29)", () => {
      expect(validateRunSubmission(run({ distanceKm: 0.29, durationSeconds: 120 }), ctx())).toEqual([]);
    });
  });

  it.each([0, -1, 1.5, 172_801])("เวลา %d วินาที ไม่ถูกต้อง", (durationSeconds) => {
    expect(codes(validateRunSubmission(run({ durationSeconds }), ctx()))).toEqual(["INVALID_DURATION"]);
  });

  describe("ฤดูกาลและสิทธิ์", () => {
    it("ไม่มีฤดูกาลที่เปิดอยู่", () => {
      expect(codes(validateRunSubmission(run(), ctx({ season: null })))).toEqual(["NO_ACTIVE_SEASON_FOR_DATE"]);
    });

    it("ฤดูกาลปิดแล้ว", () => {
      const season = { startDate: "2026-10-01", endDate: "2026-12-31", status: "closed" as const };
      expect(codes(validateRunSubmission(run(), ctx({ season })))).toEqual(["NO_ACTIVE_SEASON_FOR_DATE"]);
    });

    it("วันที่ก่อนเริ่มฤดูกาล (แม้ไม่เกิน 7 วัน)", () => {
      const c = ctx({ today: "2026-10-03" });
      expect(codes(validateRunSubmission(run({ runDate: "2026-09-30" }), c))).toEqual(["NO_ACTIVE_SEASON_FOR_DATE"]);
    });

    it("ไม่อยู่ในรายชื่อผู้มีสิทธิ์", () => {
      expect(codes(validateRunSubmission(run(), ctx({ isParticipant: false })))).toEqual(["NOT_A_PARTICIPANT"]);
    });
  });

  describe("รูปหลักฐาน", () => {
    it("ต้องมีอย่างน้อย 1 รูป", () => {
      expect(codes(validateRunSubmission(run(), ctx({ evidenceCount: 0 })))).toEqual(["EVIDENCE_REQUIRED"]);
    });

    it("ไม่เกินจำนวนที่กติกากำหนด", () => {
      expect(validateRunSubmission(run(), ctx({ evidenceCount: 4 }))).toEqual([
        { code: "TOO_MANY_EVIDENCE_FILES", details: { max: 3 } },
      ]);
    });
  });

  it("รายงานทุกข้อผิดพลาดพร้อมกัน", () => {
    const r = validateRunSubmission(run({ runDate: "2026-10-25", distanceKm: 0.05, durationSeconds: 0 }), ctx({ evidenceCount: 0 }));
    expect(codes(r)).toEqual(["DISTANCE_BELOW_MIN", "INVALID_DURATION", "RUN_DATE_IN_FUTURE", "EVIDENCE_REQUIRED"]);
  });
});

describe("computeFlags — กฎติดธง (ไม่ปฏิเสธอัตโนมัติ)", () => {
  const flagCodes = (...args: Parameters<typeof computeFlags>) => computeFlags(...args).map((f) => f.code);

  it("รายการปกติไม่ติดธง", () => {
    expect(computeFlags(run(), DEFAULT_RULES)).toEqual([]);
  });

  it("pace เร็วกว่า 3:00 /กม. (seed: 15 กม. ใน 40 นาที)", () => {
    expect(computeFlags(run({ distanceKm: 15, durationSeconds: 2400 }), DEFAULT_RULES)).toEqual([
      { code: "pace_too_fast", details: { pace_sec_per_km: 160, threshold: 180 } },
    ]);
  });

  it("pace พอดี 3:00 ไม่ติดธง (ขอบเขต)", () => {
    expect(flagCodes(run({ distanceKm: 10, durationSeconds: 1800 }), DEFAULT_RULES)).toEqual([]);
  });

  it("pace ช้ากว่า 20:00 /กม.", () => {
    expect(flagCodes(run({ distanceKm: 1, durationSeconds: 1500 }), DEFAULT_RULES)).toEqual(["pace_too_slow"]);
    expect(flagCodes(run({ distanceKm: 1, durationSeconds: 1200 }), DEFAULT_RULES)).toEqual([]);
  });

  it("ระยะต่อครั้งเกิน 42.2 กม.", () => {
    expect(flagCodes(run({ distanceKm: 42.2, durationSeconds: 15000 }), DEFAULT_RULES)).toEqual([]);
    expect(flagCodes(run({ distanceKm: 42.21, durationSeconds: 15000 }), DEFAULT_RULES)).toEqual(["distance_high"]);
  });

  it("ระยะรวมต่อวันเกิน 50 กม. นับเฉพาะรายการที่รอตรวจ/อนุมัติแล้ว", () => {
    const others = [
      { distanceKm: 30, status: "approved" as const },
      { distanceKm: 15, status: "pending" as const },
      { distanceKm: 40, status: "rejected" as const },
      { distanceKm: 40, status: "cancelled" as const },
    ];
    expect(computeFlags(run({ distanceKm: 5.01, durationSeconds: 1800 }), DEFAULT_RULES, others)).toEqual([
      { code: "daily_total_high", details: { daily_km: 50.01, threshold: 50 } },
    ]);
    expect(flagCodes(run({ distanceKm: 5, durationSeconds: 1800 }), DEFAULT_RULES, others)).toEqual([]);
  });

  it("รายการซ้ำ: วันเดียวกันและระยะเท่ากัน (seed: ปวีณา 3.2 กม. 2 ครั้ง)", () => {
    const r = run({ runDate: "2026-10-19", distanceKm: 3.2, durationSeconds: 1320 });
    expect(flagCodes(r, DEFAULT_RULES, [{ distanceKm: 3.2, status: "pending" }])).toEqual(["duplicate_entry"]);
    expect(flagCodes(r, DEFAULT_RULES, [{ distanceKm: 3.2, status: "rejected" }])).toEqual([]);
    expect(flagCodes(r, DEFAULT_RULES, [{ distanceKm: 3.21, status: "pending" }])).toEqual([]);
  });

  it("ติดหลายธงพร้อมกันได้", () => {
    const r = run({ distanceKm: 45, durationSeconds: 6000 });
    expect(flagCodes(r, DEFAULT_RULES, [{ distanceKm: 45, status: "approved" }])).toEqual([
      "pace_too_fast",
      "distance_high",
      "daily_total_high",
      "duplicate_entry",
    ]);
  });

  it("เกณฑ์ตั้งได้ และปิดได้ด้วย null", () => {
    const off: SeasonRules = {
      ...DEFAULT_RULES,
      flagMinPaceSecPerKm: null,
      flagMaxPaceSecPerKm: null,
      flagMaxDistanceKm: null,
      flagMaxDailyKm: null,
    };
    expect(flagCodes(run({ distanceKm: 100, durationSeconds: 600 }), off, [{ distanceKm: 300, status: "approved" }])).toEqual([]);
    const strict = { ...DEFAULT_RULES, flagMinPaceSecPerKm: 240 };
    expect(flagCodes(run({ distanceKm: 10, durationSeconds: 2300 }), strict)).toEqual(["pace_too_fast"]);
  });
});

describe("allowedRunDateRange", () => {
  it("ช่วงวันที่เลือกได้ = 7 วันย้อนหลังถึงวันนี้", () => {
    expect(allowedRunDateRange(TODAY, DEFAULT_RULES, { startDate: "2026-10-01", endDate: "2026-12-31" })).toEqual({
      min: "2026-10-14",
      max: "2026-10-21",
    });
  });

  it("ตัดด้วยวันเริ่ม/สิ้นสุดฤดูกาล", () => {
    expect(allowedRunDateRange("2026-10-03", DEFAULT_RULES, { startDate: "2026-10-01", endDate: "2026-12-31" })).toEqual({
      min: "2026-10-01",
      max: "2026-10-03",
    });
    expect(allowedRunDateRange("2027-01-02", DEFAULT_RULES, { startDate: "2026-10-01", endDate: "2026-12-31" })).toEqual({
      min: "2026-12-26",
      max: "2026-12-31",
    });
  });

  it("ไม่มีวันที่เลือกได้เมื่อฤดูกาลจบนานแล้ว", () => {
    expect(allowedRunDateRange("2027-02-01", DEFAULT_RULES, { startDate: "2026-10-01", endDate: "2026-12-31" })).toBeNull();
  });
});

describe("previewPace", () => {
  it("แสดง pace ระหว่างกรอกฟอร์ม", () => {
    expect(previewPace(5.2, 1860)).toBe(358);
  });

  it("ข้อมูลยังไม่ครบคืน null", () => {
    expect(previewPace(0, 1860)).toBeNull();
    expect(previewPace(Number.NaN, 1860)).toBeNull();
    expect(previewPace(5, 0)).toBeNull();
  });
});
