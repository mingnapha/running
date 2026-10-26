import { json, readJson, route } from "@/lib/server/api";
import { createSeason } from "@/lib/server/services/admin";
import { requireAuth } from "@/lib/server/session";
import { seasonInputSchema } from "@/lib/validation";

export const POST = route(async (req) => {
  const auth = await requireAuth({ roles: ["admin"] });
  return json(await createSeason(auth, await readJson(req, seasonInputSchema)), { status: 201 });
});
