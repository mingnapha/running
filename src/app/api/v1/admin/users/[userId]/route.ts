import { json, parseOrThrow, readJson, route, uuid } from "@/lib/server/api";
import { updateUser } from "@/lib/server/services/admin";
import { requireAuth } from "@/lib/server/session";
import { userUpdateSchema } from "@/lib/validation";

export const PATCH = route<{ userId: string }>(async (req, { params }) => {
  const userId = parseOrThrow(uuid, (await params).userId);
  const auth = await requireAuth({ roles: ["admin"] });
  return json(await updateUser(auth, userId, await readJson(req, userUpdateSchema)));
});
