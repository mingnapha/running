import { z } from "zod";
import { json, route, searchParams } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { getReviewQueue } from "@/lib/server/services/review";
import { getCurrentSeason } from "@/lib/server/services/seasons";
import { requireAuth } from "@/lib/server/session";

const query = z.object({
  seasonId: z.uuid().optional(),
  flagged: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = route(async (req) => {
  const auth = await requireAuth({ roles: ["approver", "admin"] });
  const q = searchParams(req, query);
  const seasonId = q.seasonId ?? (await getCurrentSeason(auth.db, auth.user.id))?.season.id;
  if (!seasonId) throw new AppError("NOT_FOUND", 404);
  return json(await getReviewQueue(auth, { seasonId, flagged: q.flagged, limit: q.limit }));
});
