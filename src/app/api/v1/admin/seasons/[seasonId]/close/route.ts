import { json, parseOrThrow, readJson, route, uuid } from "@/lib/server/api";
import { closeSeason } from "@/lib/server/services/admin";
import { requireAuth } from "@/lib/server/session";
import { closeSeasonSchema } from "@/lib/validation";

export const POST = route<{ seasonId: string }>(async (req, { params }) => {
  const seasonId = parseOrThrow(uuid, (await params).seasonId);
  const auth = await requireAuth({ roles: ["admin"] });
  const { reason } = await readJson(req, closeSeasonSchema);
  return json(await closeSeason(auth, seasonId, reason));
});
