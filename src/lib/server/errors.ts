import "server-only";

/**
 * Error ที่ส่งกลับให้หน้าเว็บ: { error: { code, message, details } }
 * message แปลจาก code ฝั่งหน้าเว็บ (messages/*.json → errors.<CODE>) ตามภาษาของผู้ใช้
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "AppError";
  }
}

/** HTTP status ของรหัสจากฐานข้อมูล (SQLSTATE WR001) — ที่ไม่อยู่ในนี้คือ 422 */
const DB_CODE_STATUS: Record<string, number> = {
  NOT_AUTHENTICATED: 401,
  FORBIDDEN: 403,
  RUN_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  DELETION_ALREADY_REQUESTED: 409,
  PRIVACY_NOTICE_OUTDATED: 409,
};

interface PostgrestLikeError {
  code?: string;
  message?: string;
  details?: string | null;
}

/** แปลง error จาก supabase-js เป็น AppError */
export function fromDbError(error: PostgrestLikeError): AppError {
  if (error.code === "WR001" && error.message) {
    let details: Record<string, unknown> | undefined;
    if (error.details) {
      try {
        details = JSON.parse(error.details) as Record<string, unknown>;
      } catch {
        details = undefined;
      }
    }
    return new AppError(error.message, DB_CODE_STATUS[error.message] ?? 422, details);
  }
  // unique_violation / exclusion_violation
  if (error.code === "23505") return new AppError("CONFLICT", 409);
  if (error.code === "23P01") return new AppError("SEASON_OVERLAP", 409);
  // check_violation, not_null_violation, invalid_text_representation
  if (error.code === "23514" || error.code === "23502" || error.code === "22P02") {
    return new AppError("VALIDATION_ERROR", 400);
  }
  if (error.code === "42501") return new AppError("FORBIDDEN", 403);
  if (error.code === "PGRST116") return new AppError("NOT_FOUND", 404);
  if (error.code === "PGRST301" || error.code === "PGRST303") return new AppError("NOT_AUTHENTICATED", 401);
  console.error("Unexpected database error", error);
  return new AppError("INTERNAL_ERROR", 500);
}

/**
 * ใช้กับผลของ supabase-js: คืน data หรือโยน AppError
 * (ผลของ maybeSingle() อาจเป็น null — ผู้เรียกระบุชนิดเป็น `X | null` เอง)
 */
export function unwrap<T>(result: { data: T; error: PostgrestLikeError | null }): NonNullable<T> {
  if (result.error) throw fromDbError(result.error);
  return result.data as NonNullable<T>;
}
