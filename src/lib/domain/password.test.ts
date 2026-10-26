import { describe, expect, it } from "vitest";
import { checkPassword, generateTemporaryPassword } from "./password";

describe("checkPassword", () => {
  it("รหัสผ่านที่ดีผ่าน", () => {
    expect(checkPassword("วิ่งทุกวัน2569", "EMP001")).toEqual([]);
    expect(checkPassword("running-2026", "EMP001")).toEqual([]);
  });

  it("บอกปัญหาทุกข้อ", () => {
    expect(checkPassword("abc", "EMP001")).toEqual(["too_short", "needs_digit"]);
    expect(checkPassword("1234567890", "EMP001")).toEqual(["needs_letter"]);
    expect(checkPassword("x".repeat(129) + "1", "EMP001")).toEqual(["too_long"]);
  });

  it("ห้ามมีรหัสพนักงาน (ไม่สนตัวพิมพ์เล็ก/ใหญ่)", () => {
    expect(checkPassword("myemp001pass", "EMP001")).toEqual(["contains_username"]);
  });

  it("ห้ามซ้ำรหัสเดิม", () => {
    expect(checkPassword("WorkingRun#2569", "EMP001", "WorkingRun#2569")).toEqual(["same_as_current"]);
  });
});

describe("generateTemporaryPassword", () => {
  it("ยาว 12 ตัว ผ่านนโยบาย และไม่มีตัวที่สับสน", () => {
    for (let i = 0; i < 200; i++) {
      const p = generateTemporaryPassword();
      expect(p).toHaveLength(12);
      expect(checkPassword(p, "EMP001")).toEqual([]);
      expect(p).not.toMatch(/[0O1lIo]/);
    }
  });

  it("สุ่มใหม่ถ้าไม่มีตัวเลข", () => {
    // ครั้งแรก: byte 0 ทั้งหมด = "AAAA…" (ไม่มีตัวเลข) → สุ่มใหม่; ครั้งที่สอง: byte 47 = "3" ตามด้วย "A"
    const batches = [new Uint8Array(12).fill(0), Uint8Array.from([47, ...new Array(11).fill(0)])];
    let calls = 0;
    const p = generateTemporaryPassword(12, () => batches[calls++]!);
    expect(calls).toBe(2);
    expect(p).toBe("3AAAAAAAAAAA");
  });
});
