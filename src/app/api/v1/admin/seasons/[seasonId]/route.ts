import { json, noContent, parseOrThrow, readJson, route, uuid } from "@/lib/server/api";
import { deleteSeason, updateSeason } from "@/lib/server/services/admin";
import { requireAuth } from "@/lib/server/session";
import { seasonInputSchema } from "@/lib/validation";

type P = { seasonId: string };

export const PATCH = route<P>(async (req, { params }) => {
  const seasonId = parseOrThrow(uuid, (await params).seasonId);
  const auth = await requireAuth({ roles: ["admin"] });
  return json(await updateSeason(auth, seasonId, await readJson(req, seasonInputSchema)));
});

export const DELETE = route<P>(async (_req, { params }) => {
  const seasonId = parseOrThrow(uuid, (await params).seasonId);
  const auth = await requireAuth({ roles: ["admin"] });
  await deleteSeason(auth, seasonId);
  return noContent();
});
