/**
 * ตัวเลขทศนิยม 2 ตำแหน่ง (ระยะทาง กม. และคะแนน) คำนวณเป็นจำนวนเต็ม "ร้อยส่วน"
 * เพื่อเลี่ยงปัญหา floating point (เช่น 0.1 + 0.2) และให้ผลตรงกับ numeric ของ Postgres
 */

/** แปลงค่าทศนิยม 2 ตำแหน่งเป็นจำนวนเต็มร้อยส่วน เช่น 3.25 → 325 */
export function toCents(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`Not a finite number: ${value}`);
  return Math.round(value * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * หาร a/b แล้วปัดครึ่งออกจากศูนย์ (เหมือน round() ของ Postgres numeric)
 * ใช้จำนวนเต็มทั้งหมด จึงไม่มีความคลาดเคลื่อนจาก floating point
 */
export function divRoundHalfAwayFromZero(a: number, b: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || b === 0) {
    throw new RangeError(`Invalid integer division ${a}/${b}`);
  }
  const sign = Math.sign(a) * Math.sign(b);
  const absA = Math.abs(a);
  const absB = Math.abs(b);
  const q = Math.floor(absA / absB);
  const r = absA - q * absB;
  return sign * (2 * r >= absB ? q + 1 : q);
}

/** ปัดทศนิยม 2 ตำแหน่งสำหรับแสดงผล/เปรียบเทียบ */
export function round2(value: number): number {
  return fromCents(toCents(value));
}
