import { json, parseOrThrow, readJson, route, uuid } from "@/lib/server/api";
import { setRoles } from "@/lib/server/services/admin";
import { requireAuth } from "@/lib/server/session";
import { rolesSchema } from "@/lib/validation";

export const PUT = route<{ userId: string }>(async (req, { params }) => {
  const userId = parseOrThrow(uuid, (await params).userId);
  const auth = await requireAuth({ roles: ["admin"] });
  const { roles } = await readJson(req, rolesSchema);
  return json(await setRoles(auth, userId, [...new Set(roles)]));
});
