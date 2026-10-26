import type { IsoDate } from "./types";

/**
 * วันเวลาของระบบ — เก็บ UTC แสดงผลเป็นเวลากรุงเทพฯ
 * ประเทศไทยไม่มี daylight saving จึงใช้ UTC+7 คงที่ (ไม่ขึ้นกับ ICU ของ runtime)
 */
export const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type Locale = "th" | "en";

function toDate(value: Date | string): Date {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) throw new RangeError(`Invalid date: ${String(value)}`);
  return d;
}

/** "วันนี้" ตามปฏิทินกรุงเทพฯ (YYYY-MM-DD) — ตรงกับ public.app_today() */
export function bangkokToday(now: Date = new Date()): IsoDate {
  return new Date(now.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

export function parseIsoDate(value: IsoDate): { year: number; month: number; day: number } {
  const m = ISO_DATE_RE.exec(value);
  if (!m) throw new RangeError(`Invalid ISO date: ${value}`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new RangeError(`Invalid ISO date: ${value}`);
  }
  return { year, month, day };
}

export function isValidIsoDate(value: string): boolean {
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const { year, month, day } = parseIsoDate(date);
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
}

/** จำนวนวันจาก a ถึง b (b - a) */
export function diffDays(a: IsoDate, b: IsoDate): number {
  const pa = parseIsoDate(a);
  const pb = parseIsoDate(b);
  return Math.round((Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / DAY_MS);
}

function formatParts(year: number, month: number, day: number, locale: Locale): string {
  return locale === "th"
    ? `${day} ${THAI_MONTHS[month - 1]} ${year + 543}`
    : `${day} ${EN_MONTHS[month - 1]} ${year}`;
}

/** วันที่ตามปฏิทิน (เช่น run_date) → "16 ต.ค. 2569" / "16 Oct 2026" */
export function formatIsoDate(date: IsoDate, locale: Locale = "th"): string {
  const { year, month, day } = parseIsoDate(date);
  return formatParts(year, month, day, locale);
}

/** จุดเวลา (timestamptz) → วันที่ตามเวลากรุงเทพฯ "16 ต.ค. 2569" */
export function formatDate(value: Date | string, locale: Locale = "th"): string {
  const b = new Date(toDate(value).getTime() + BANGKOK_OFFSET_MS);
  return formatParts(b.getUTCFullYear(), b.getUTCMonth() + 1, b.getUTCDate(), locale);
}

/** จุดเวลา → เวลากรุงเทพฯ "14:25 น." / "14:25" */
export function formatTime(value: Date | string, locale: Locale = "th"): string {
  const b = new Date(toDate(value).getTime() + BANGKOK_OFFSET_MS);
  const hhmm = `${String(b.getUTCHours()).padStart(2, "0")}:${String(b.getUTCMinutes()).padStart(2, "0")}`;
  return locale === "th" ? `${hhmm} น.` : hhmm;
}

/** "16 ต.ค. 2569 14:25 น." */
export function formatDateTime(value: Date | string, locale: Locale = "th"): string {
  return `${formatDate(value, locale)} ${formatTime(value, locale)}`;
}

/** เวลาวิ่ง: 1860 → "31:00", 3723 → "1:02:03" */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mmss = `${String(m).padStart(h > 0 ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

/** pace: 358 → "5:58" (นาที:วินาที ต่อ กม.) */
export function formatPace(secPerKm: number): string {
  const s = Math.max(0, Math.round(secPerKm));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
