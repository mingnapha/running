import { json, parseOrThrow, readJson, route, uuid } from "@/lib/server/api";
import { decideRun } from "@/lib/server/services/review";
import { requireAuth } from "@/lib/server/session";
import { reviewDecisionSchema } from "@/lib/validation";

export const POST = route<{ runId: string }>(async (req, { params }) => {
  const runId = parseOrThrow(uuid, (await params).runId);
  const auth = await requireAuth({ roles: ["approver", "admin"] });
  const { decision, reason } = await readJson(req, reviewDecisionSchema);
  return json(await decideRun(auth, runId, decision, reason));
});
