/**
 * รูปแบบข้อมูลที่ API ส่งให้หน้าเว็บ — ตรงกับ components/schemas ใน docs/api/openapi.yaml
 * (ใช้ได้ทั้งฝั่ง server และ client)
 */
import type { FlagCode, IsoDate, LedgerEntryType, Role, RunStatus, SeasonRules, SeasonStatus } from "./domain/types";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export interface Department {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
}

export interface Me {
  id: string;
  employeeCode: string;
  displayName: string;
  department: Department | null;
  locale: "th" | "en";
  roles: Role[];
  mustChangePassword: boolean;
  needsConsent: boolean;
}

export interface Season {
  id: string;
  nameTh: string;
  nameEn: string;
  startDate: IsoDate;
  endDate: IsoDate;
  status: SeasonStatus;
  leaderboardVersion: number;
  closedAt: string | null;
}

export interface SeasonRulesDto extends SeasonRules {
  id: string;
  seasonId: string;
  version: number;
  changeReason: string;
  createdAt: string;
}

export interface CurrentSeason {
  season: Season;
  rules: SeasonRulesDto;
  isParticipant: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  previousRank: number | null;
  userId: string;
  displayName: string;
  department: Department | null;
  totalPoints: number;
  totalDistanceKm: number;
  approvedRunCount: number;
  reachedAt: string;
}

export interface Leaderboard {
  seasonId: string;
  version: number;
  generatedAt: string;
  entries: LeaderboardEntry[];
  unranked: { userId: string; displayName: string }[];
}

export interface MyStats {
  seasonId: string;
  rank: number | null;
  previousRank: number | null;
  totalPoints: number;
  totalDistanceKm: number;
  approvedRunCount: number;
  pendingRunCount: number;
  pendingDistanceKm: number;
  participantCount: number;
  pointsToNextRank: number | null;
}

export interface Review {
  decision: "approved" | "rejected" | "revoked";
  reason: string | null;
  reviewerName: string;
  at: string;
}

export interface Run {
  id: string;
  seasonId: string;
  runDate: IsoDate;
  distanceKm: number;
  durationSeconds: number;
  paceSecPerKm: number;
  note: string | null;
  status: RunStatus;
  points: number | null;
  submittedAt: string;
  decidedAt: string | null;
  latestReview: Review | null;
  flagCodes: FlagCode[];
}

export interface EvidenceRef {
  id: string;
  url: string | null;
  purged: boolean;
  purgeAfter: string;
}

export interface RunDetail extends Run {
  runner: { id: string; displayName: string; employeeCode?: string };
  evidence: EvidenceRef[];
  flags: { code: FlagCode; detail: Record<string, unknown> }[];
  reviews: Review[];
}

export interface UploadedEvidence {
  objectKey: string;
  contentSha256: string;
  mimeType: string;
  byteSize: number;
}

export interface LedgerEntry {
  id: number;
  entryType: LedgerEntryType;
  runId: string | null;
  points: number;
  distanceKm: number;
  reason: string;
  createdBy: string | null;
  createdAt: string;
}

export interface UserAdmin {
  id: string;
  employeeCode: string;
  displayName: string;
  department: Department | null;
  isActive: boolean;
  roles: Role[];
  mustChangePassword: boolean;
  consentedAt: string | null;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}
