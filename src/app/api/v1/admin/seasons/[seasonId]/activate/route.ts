import { json, parseOrThrow, route, uuid } from "@/lib/server/api";
import { activateSeason } from "@/lib/server/services/admin";
import { requireAuth } from "@/lib/server/session";

export const POST = route<{ seasonId: string }>(async (_req, { params }) => {
  const seasonId = parseOrThrow(uuid, (await params).seasonId);
  const auth = await requireAuth({ roles: ["admin"] });
  return json(await activateSeason(auth, seasonId));
});
