import { json, parseOrThrow, route, uuid } from "@/lib/server/api";
import { getMyStats } from "@/lib/server/services/leaderboard";
import { requireAuth } from "@/lib/server/session";

export const GET = route<{ seasonId: string }>(async (_req, { params }) => {
  const seasonId = parseOrThrow(uuid, (await params).seasonId);
  const auth = await requireAuth();
  return json(await getMyStats(auth.db, seasonId, auth.user.id));
});
