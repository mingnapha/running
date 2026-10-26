import { json, parseOrThrow, readJson, route, uuid } from "@/lib/server/api";
import { addParticipants, listParticipants } from "@/lib/server/services/admin";
import { requireAuth } from "@/lib/server/session";
import { participantsAddSchema } from "@/lib/validation";

type P = { seasonId: string };

export const GET = route<P>(async (_req, { params }) => {
  const seasonId = parseOrThrow(uuid, (await params).seasonId);
  const auth = await requireAuth({ roles: ["admin"] });
  const items = await listParticipants(auth, seasonId);
  return json({ items, total: items.length, nextCursor: null });
});

export const POST = route<P>(async (req, { params }) => {
  const seasonId = parseOrThrow(uuid, (await params).seasonId);
  const auth = await requireAuth({ roles: ["admin"] });
  const { employeeCodes } = await readJson(req, participantsAddSchema);
  return json(await addParticipants(auth, seasonId, employeeCodes));
});
