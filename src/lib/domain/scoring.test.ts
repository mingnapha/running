import { describe, expect, it } from "vitest";
import { divRoundHalfAwayFromZero } from "./decimal";
import { computePaceSecPerKm, computePoints, toDurationSeconds } from "./scoring";

describe("computePoints", () => {
  it("คิดคะแนนจากระยะทาง × แต้มต่อ กม. (ตัวอย่างจากโจทย์: 3.0 กม. = +30)", () => {
    expect(computePoints(3.0, 10)).toBe(30);
  });

  it.each([
    [5.2, 10, 52],
    [0.1, 10, 1],
    [21.1, 8, 168.8],
    [42.2, 12, 506.4],
    [8.4, 8, 67.2],
  ])("%d กม. × %d แต้ม = %d", (km, rate, expected) => {
    expect(computePoints(km, rate)).toBe(expected);
  });

  it("อัตราแต้มต่อ กม. ปรับได้ต่อฤดูกาล (ไม่ hard-code)", () => {
    expect(computePoints(5, 8)).toBe(40);
    expect(computePoints(5, 12.5)).toBe(62.5);
  });

  it("ไม่มีความคลาดเคลื่อนแบบ floating point", () => {
    // 0.07 * 3 ใน JavaScript = 0.21000000000000002
    expect(computePoints(0.07, 3)).toBe(0.21);
    // 1.15 * 0.5 = 0.575 → ปัดครึ่งขึ้นเป็น 0.58 เหมือน Postgres round()
    expect(computePoints(1.15, 0.5)).toBe(0.58);
    expect(computePoints(1.01, 1.5)).toBe(1.52);
  });

  it("ปฏิเสธค่าที่ไม่เป็นบวก", () => {
    expect(() => computePoints(0, 10)).toThrow(RangeError);
    expect(() => computePoints(-1, 10)).toThrow(RangeError);
    expect(() => computePoints(5, 0)).toThrow(RangeError);
    expect(() => computePoints(Number.NaN, 10)).toThrow(RangeError);
  });
});

describe("computePaceSecPerKm", () => {
  it("คิด pace เป็นวินาทีต่อ กม. ปัดเป็นจำนวนเต็ม", () => {
    expect(computePaceSecPerKm(1860, 5.2)).toBe(358); // 357.69 → 358
    expect(computePaceSecPerKm(1500, 10)).toBe(150);
    expect(computePaceSecPerKm(2400, 15)).toBe(160);
  });

  it("ปัดครึ่งขึ้นเหมือน Postgres (500.5 → 501)", () => {
    expect(computePaceSecPerKm(1001, 2)).toBe(501);
  });

  it("ต้องเป็นวินาทีจำนวนเต็มบวก", () => {
    expect(() => computePaceSecPerKm(0, 5)).toThrow(RangeError);
    expect(() => computePaceSecPerKm(10.5, 5)).toThrow(RangeError);
    expect(() => computePaceSecPerKm(100, 0)).toThrow(RangeError);
  });
});

describe("toDurationSeconds", () => {
  it("แปลง ชม./นาที/วินาที จากฟอร์ม", () => {
    expect(toDurationSeconds(0, 31, 0)).toBe(1860);
    expect(toDurationSeconds(1, 2, 3)).toBe(3723);
  });

  it("ปฏิเสธค่าเกินช่วง", () => {
    expect(() => toDurationSeconds(0, 60, 0)).toThrow(RangeError);
    expect(() => toDurationSeconds(0, 0, 60)).toThrow(RangeError);
    expect(() => toDurationSeconds(-1, 0, 0)).toThrow(RangeError);
    expect(() => toDurationSeconds(0, 1.5, 0)).toThrow(RangeError);
  });
});

describe("divRoundHalfAwayFromZero", () => {
  it.each([
    [5, 2, 3],
    [4, 2, 2],
    [-5, 2, -3],
    [7, 3, 2],
    [8, 3, 3],
  ])("%d / %d = %d", (a, b, expected) => {
    expect(divRoundHalfAwayFromZero(a, b)).toBe(expected);
  });

  it("ห้ามหารด้วยศูนย์", () => {
    expect(() => divRoundHalfAwayFromZero(1, 0)).toThrow(RangeError);
  });
});
