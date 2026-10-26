import { json, parseOrThrow, route, uuid } from "@/lib/server/api";
import { listRules } from "@/lib/server/services/seasons";
import { requireAuth } from "@/lib/server/session";

export const GET = route<{ seasonId: string }>(async (_req, { params }) => {
  const seasonId = parseOrThrow(uuid, (await params).seasonId);
  const auth = await requireAuth();
  return json({ items: await listRules(auth.db, seasonId) });
});
