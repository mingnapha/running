import { z } from "zod";
import { isValidIsoDate } from "./domain/datetime";
import { MAX_DISTANCE_KM, MAX_DURATION_SECONDS } from "./domain/runRules";

/** schema ที่ใช้ทั้งฟอร์มและ API (ตรงกับ docs/api/openapi.yaml) */

const isoDate = z.string().refine(isValidIsoDate, "invalid_date");
const twoDecimals = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
const role = z.enum(["runner", "approver", "admin"]);

export const loginSchema = z.object({
  username: z.string().trim().regex(/^[A-Za-z0-9._-]{3,32}$/),
  password: z.string().min(1).max(128),
  turnstileToken: z.string().min(1),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(128),
});

export const updateMeSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  locale: z.enum(["th", "en"]).optional(),
});

export const consentSchema = z.object({ version: z.string().min(1).max(40) });

export const runCreateSchema = z.object({
  runDate: isoDate,
  distanceKm: z.number().positive().max(MAX_DISTANCE_KM).refine(twoDecimals, "max_2_decimals"),
  durationSeconds: z.number().int().min(1).max(MAX_DURATION_SECONDS),
  note: z.string().trim().max(280).optional(),
  evidenceKeys: z.array(z.string().min(1).max(512)).min(1).max(10),
});

export const reviewDecisionSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.decision === "approved" || (v.reason ?? "").length > 0, { message: "reason_required", path: ["reason"] });

export const seasonInputSchema = z
  .object({
    nameTh: z.string().trim().min(1).max(100),
    nameEn: z.string().trim().min(1).max(100),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((v) => v.endDate >= v.startDate, { message: "end_before_start", path: ["endDate"] });

const nullablePositiveInt = z.number().int().positive().nullable();
const nullablePositiveKm = z.number().positive().max(1000).refine(twoDecimals).nullable();

export const rulesInputSchema = z
  .object({
    pointsPerKm: z.number().positive().max(1000).refine(twoDecimals),
    minDistanceKm: z.number().min(0.01).max(100).refine(twoDecimals),
    maxBackdateDays: z.number().int().min(0).max(90),
    maxEvidenceFiles: z.number().int().min(1).max(10),
    flagMinPaceSecPerKm: nullablePositiveInt,
    flagMaxPaceSecPerKm: nullablePositiveInt,
    flagMaxDistanceKm: nullablePositiveKm,
    flagMaxDailyKm: nullablePositiveKm,
    changeReason: z.string().trim().min(1).max(500),
    recalculate: z.boolean().default(false),
  })
  .refine(
    (v) => v.flagMinPaceSecPerKm === null || v.flagMaxPaceSecPerKm === null || v.flagMinPaceSecPerKm < v.flagMaxPaceSecPerKm,
    { message: "pace_order", path: ["flagMaxPaceSecPerKm"] },
  );

export const participantsAddSchema = z.object({
  employeeCodes: z.array(z.string().trim().min(1).max(32)).min(1).max(2000),
});

export const userCreateSchema = z.object({
  employeeCode: z.string().trim().regex(/^[A-Za-z0-9._-]{3,32}$/),
  displayName: z.string().trim().min(1).max(60),
  departmentId: z.uuid().nullable().default(null),
  roles: z.array(role).default(["runner"]),
  addToSeasonId: z.uuid().optional(),
});

export const userUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  departmentId: z.uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const rolesSchema = z.object({ roles: z.array(role).max(3) });

export const closeSeasonSchema = z.object({ reason: z.string().trim().max(500).optional() });
