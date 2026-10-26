import { noContent, parseOrThrow, route, uuid } from "@/lib/server/api";
import { cancelRun } from "@/lib/server/services/runs";
import { requireAuth } from "@/lib/server/session";

export const POST = route<{ runId: string }>(async (_req, { params }) => {
  const runId = parseOrThrow(uuid, (await params).runId);
  const auth = await requireAuth();
  await cancelRun(auth, runId);
  return noContent();
});
