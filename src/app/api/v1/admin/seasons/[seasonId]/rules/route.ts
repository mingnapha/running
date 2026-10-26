import { json, parseOrThrow, readJson, route, uuid } from "@/lib/server/api";
import { addRulesVersion } from "@/lib/server/services/admin";
import { requireAuth } from "@/lib/server/session";
import { rulesInputSchema } from "@/lib/validation";

export const POST = route<{ seasonId: string }>(async (req, { params }) => {
  const seasonId = parseOrThrow(uuid, (await params).seasonId);
  const auth = await requireAuth({ roles: ["admin"] });
  const { changeReason, recalculate, ...rules } = await readJson(req, rulesInputSchema);
  return json(await addRulesVersion(auth, seasonId, rules, changeReason, recalculate), { status: 201 });
});
