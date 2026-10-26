import { parseOrThrow, route, uuid } from "@/lib/server/api";
import { getEvidenceFile } from "@/lib/server/services/runs";
import { requireAuth } from "@/lib/server/session";

export const GET = route<{ runId: string; evidenceId: string }>(async (_req, { params }) => {
  const p = await params;
  const auth = await requireAuth();
  return getEvidenceFile(auth, parseOrThrow(uuid, p.runId), parseOrThrow(uuid, p.evidenceId));
});
