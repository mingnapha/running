import { divRoundHalfAwayFromZero, fromCents, toCents } from "./decimal";

/**
 * คะแนนจากระยะทาง = ระยะ (กม.) × แต้มต่อ กม. ของฤดูกาล ปัดทศนิยม 2 ตำแหน่ง
 * ตรงกับ public.compute_points() ในฐานข้อมูล
 *
 * @example computePoints(3.0, 10) === 30
 */
export function computePoints(distanceKm: number, pointsPerKm: number): number {
  if (!(distanceKm > 0)) throw new RangeError("distanceKm must be positive");
  if (!(pointsPerKm > 0)) throw new RangeError("pointsPerKm must be positive");
  // ร้อยส่วน × ร้อยส่วน = หมื่นส่วน → หาร 100 กลับเป็นร้อยส่วน
  const product = toCents(distanceKm) * toCents(pointsPerKm);
  return fromCents(divRoundHalfAwayFromZero(product, 100));
}

/**
 * pace (วินาทีต่อ กม.) ปัดเป็นจำนวนเต็ม — ตรงกับคอลัมน์ generated runs.pace_sec_per_km
 */
export function computePaceSecPerKm(durationSeconds: number, distanceKm: number): number {
  if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
    throw new RangeError("durationSeconds must be a positive integer");
  }
  if (!(distanceKm > 0)) throw new RangeError("distanceKm must be positive");
  return divRoundHalfAwayFromZero(durationSeconds * 100, toCents(distanceKm));
}

/** ชั่วโมง/นาที/วินาทีจากฟอร์ม → วินาทีรวม */
export function toDurationSeconds(hours: number, minutes: number, seconds: number): number {
  for (const [name, v, max] of [
    ["hours", hours, 47],
    ["minutes", minutes, 59],
    ["seconds", seconds, 59],
  ] as const) {
    if (!Number.isInteger(v) || v < 0 || v > max) throw new RangeError(`${name} out of range`);
  }
  return hours * 3600 + minutes * 60 + seconds;
}
