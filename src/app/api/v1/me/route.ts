import { json, readJson, route } from "@/lib/server/api";
import { unwrap } from "@/lib/server/errors";
import { loadCurrentUser, requireAuth, writeLocale } from "@/lib/server/session";
import { updateMeSchema } from "@/lib/validation";

export const GET = route(async () => {
  const { user } = await requireAuth({ allowGated: true });
  return json(user);
});

export const PATCH = route(async (req) => {
  const auth = await requireAuth({ allowGated: true });
  const input = await readJson(req, updateMeSchema);
  unwrap(await auth.db.rpc("update_my_profile", { p_display_name: input.displayName ?? null, p_locale: input.locale ?? null }));
  if (input.locale) await writeLocale(input.locale);
  return json(await loadCurrentUser(auth.db));
});
