import { noContent, parseOrThrow, route, uuid } from "@/lib/server/api";
import { removeParticipant } from "@/lib/server/services/admin";
import { requireAuth } from "@/lib/server/session";

export const DELETE = route<{ seasonId: string; userId: string }>(async (_req, { params }) => {
  const p = await params;
  const auth = await requireAuth({ roles: ["admin"] });
  await removeParticipant(auth, parseOrThrow(uuid, p.seasonId), parseOrThrow(uuid, p.userId));
  return noContent();
});
