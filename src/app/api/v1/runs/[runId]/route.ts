import { json, parseOrThrow, route, uuid } from "@/lib/server/api";
import { getRunDetail } from "@/lib/server/services/runs";
import { requireAuth } from "@/lib/server/session";

export const GET = route<{ runId: string }>(async (_req, { params }) => {
  const runId = parseOrThrow(uuid, (await params).runId);
  const auth = await requireAuth();
  return json(await getRunDetail(auth, runId));
});
