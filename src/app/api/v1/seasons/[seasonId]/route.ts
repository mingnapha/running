import { json, parseOrThrow, route, uuid } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { getSeason } from "@/lib/server/services/seasons";
import { requireAuth } from "@/lib/server/session";

export const GET = route<{ seasonId: string }>(async (_req, { params }) => {
  const seasonId = parseOrThrow(uuid, (await params).seasonId);
  const auth = await requireAuth();
  const season = await getSeason(auth.db, seasonId);
  if (!season) throw new AppError("NOT_FOUND", 404);
  return json(season);
});
