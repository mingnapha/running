import { describe, expect, it } from "vitest";
import {
  addDays,
  bangkokToday,
  diffDays,
  formatDate,
  formatDateTime,
  formatDuration,
  formatIsoDate,
  formatPace,
  formatTime,
  isValidIsoDate,
} from "./datetime";

describe("bangkokToday — วันนี้ตามเวลากรุงเทพฯ (ไม่ขึ้นกับเขตเวลาเครื่อง)", () => {
  it("16:59 UTC ยังเป็นวันเดิม, 17:00 UTC เป็นวันใหม่", () => {
    expect(bangkokToday(new Date("2026-10-15T16:59:59Z"))).toBe("2026-10-15");
    expect(bangkokToday(new Date("2026-10-15T17:00:00Z"))).toBe("2026-10-16");
  });
  it("ข้ามปี", () => {
    expect(bangkokToday(new Date("2026-12-31T17:30:00Z"))).toBe("2027-01-01");
  });
});

describe("formatIsoDate — วันที่ พ.ศ.", () => {
  it('ไทย: "16 ต.ค. 2569"', () => {
    expect(formatIsoDate("2026-10-16")).toBe("16 ต.ค. 2569");
  });
  it('อังกฤษ: "16 Oct 2026"', () => {
    expect(formatIsoDate("2026-10-16", "en")).toBe("16 Oct 2026");
  });
  it("ครบทุกเดือน", () => {
    const months = Array.from({ length: 12 }, (_, i) => formatIsoDate(`2026-${String(i + 1).padStart(2, "0")}-01`).split(" ")[1]);
    expect(months).toEqual(["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]);
  });
});

describe("formatDate / formatTime — จุดเวลา UTC แสดงเป็นเวลาไทย", () => {
  it('"14:25 น."', () => {
    expect(formatTime("2026-10-16T07:25:00Z")).toBe("14:25 น.");
    expect(formatTime("2026-10-16T07:25:00Z", "en")).toBe("14:25");
  });
  it("หลังเที่ยงคืน UTC+7 เป็นวันถัดไป", () => {
    expect(formatDate("2026-10-15T18:05:00Z")).toBe("16 ต.ค. 2569");
    expect(formatTime("2026-10-15T18:05:00Z")).toBe("01:05 น.");
  });
  it("รวมวันและเวลา", () => {
    expect(formatDateTime(new Date("2026-10-16T07:25:00Z"))).toBe("16 ต.ค. 2569 14:25 น.");
  });
  it("วันที่ไม่ถูกต้อง", () => {
    expect(() => formatDate("not a date")).toThrow(RangeError);
  });
});

describe("addDays / diffDays", () => {
  it("ข้ามเดือน ปี และปีอธิกสุรทิน", () => {
    expect(addDays("2026-10-21", -7)).toBe("2026-10-14");
    expect(addDays("2027-01-03", -7)).toBe("2026-12-27");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(diffDays("2026-10-14", "2026-10-21")).toBe(7);
  });
  it("ตรวจวันที่จริง", () => {
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
  });
});

describe("formatDuration / formatPace", () => {
  it.each([
    [1860, "31:00"],
    [3723, "1:02:03"],
    [59, "0:59"],
    [36000, "10:00:00"],
  ])("%d วินาที → %s", (s, expected) => {
    expect(formatDuration(s)).toBe(expected);
  });
  it.each([
    [358, "5:58"],
    [180, "3:00"],
    [65, "1:05"],
  ])("pace %d → %s", (s, expected) => {
    expect(formatPace(s)).toBe(expected);
  });
});
