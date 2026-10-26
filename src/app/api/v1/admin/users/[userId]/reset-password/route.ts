import { json, parseOrThrow, route, uuid } from "@/lib/server/api";
import { resetPassword } from "@/lib/server/services/admin";
import { requireAuth } from "@/lib/server/session";

export const POST = route<{ userId: string }>(async (_req, { params }) => {
  const userId = parseOrThrow(uuid, (await params).userId);
  const auth = await requireAuth({ roles: ["admin"] });
  return json({ temporaryPassword: await resetPassword(auth, userId) });
});
