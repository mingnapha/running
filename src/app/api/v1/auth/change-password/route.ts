import { noContent, readJson, route } from "@/lib/server/api";
import { changePassword } from "@/lib/server/services/auth";
import { requireAuth } from "@/lib/server/session";
import { changePasswordSchema } from "@/lib/validation";

export const POST = route(async (req) => {
  const auth = await requireAuth({ allowGated: true });
  const { currentPassword, newPassword } = await readJson(req, changePasswordSchema);
  await changePassword(auth, currentPassword, newPassword);
  return noContent();
});
