/**
 * นโยบายรหัสผ่าน: อย่างน้อย 10 ตัว มีทั้งตัวอักษรและตัวเลข ต้องไม่มีรหัสพนักงานอยู่ในรหัสผ่าน
 * และรหัสชั่วคราวที่แอดมินสร้างให้ (อ่านง่าย ไม่มีตัวที่สับสน เช่น 0/O, 1/l)
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordProblem = "too_short" | "too_long" | "needs_letter" | "needs_digit" | "contains_username" | "same_as_current";

export function checkPassword(password: string, employeeCode: string, currentPassword?: string): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push("too_short");
  if (password.length > PASSWORD_MAX_LENGTH) problems.push("too_long");
  if (!/\p{L}/u.test(password)) problems.push("needs_letter");
  if (!/\d/.test(password)) problems.push("needs_digit");
  if (employeeCode.trim() && password.toLowerCase().includes(employeeCode.trim().toLowerCase())) {
    problems.push("contains_username");
  }
  if (currentPassword !== undefined && password === currentPassword) problems.push("same_as_current");
  return problems;
}

const TEMP_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const TEMP_DIGITS = "23456789";

/** รหัสผ่านชั่วคราว 12 ตัว (มีตัวเลขอย่างน้อย 1 ตัวเสมอ) — ใช้ crypto ที่ปลอดภัย */
export function generateTemporaryPassword(length = 12, random: (n: number) => Uint8Array = secureRandom): string {
  if (length < PASSWORD_MIN_LENGTH) throw new RangeError("length too short");
  for (;;) {
    const bytes = random(length);
    // ตัด byte ที่ทำให้กระจายไม่เท่ากันทิ้ง (rejection sampling)
    const limit = 256 - (256 % TEMP_ALPHABET.length);
    let out = "";
    for (const b of bytes) if (b < limit) out += TEMP_ALPHABET[b % TEMP_ALPHABET.length];
    if (out.length < length) continue;
    if (![...out].some((c) => TEMP_DIGITS.includes(c)) || !/[A-Za-z]/.test(out)) continue;
    return out;
  }
}

function secureRandom(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}
