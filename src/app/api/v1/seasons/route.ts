import { json, route } from "@/lib/server/api";
import { listSeasons } from "@/lib/server/services/seasons";
import { requireAuth } from "@/lib/server/session";

export const GET = route(async () => {
  const auth = await requireAuth();
  return json({ items: await listSeasons(auth.db) });
});
