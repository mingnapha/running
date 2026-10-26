import { noContent, readJson, route } from "@/lib/server/api";
import { unwrap } from "@/lib/server/errors";
import { requireAuth } from "@/lib/server/session";
import { consentSchema } from "@/lib/validation";

export const POST = route(async (req) => {
  const auth = await requireAuth({ allowGated: true });
  const { version } = await readJson(req, consentSchema);
  unwrap(await auth.db.rpc("accept_privacy_notice", { p_version: version }));
  return noContent();
});
