import { json, readJson, route, uuid } from "@/lib/server/api";
import { submitRun } from "@/lib/server/services/runs";
import { requireAuth } from "@/lib/server/session";
import { runCreateSchema } from "@/lib/validation";

export const POST = route(async (req) => {
  const auth = await requireAuth();
  const input = await readJson(req, runCreateSchema);
  const key = req.headers.get("idempotency-key");
  const idempotencyKey = key && uuid.safeParse(key).success ? key : null;
  return json(await submitRun(auth, input, idempotencyKey), { status: 201 });
});
