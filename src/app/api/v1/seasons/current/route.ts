import { json, route } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { getCurrentSeason } from "@/lib/server/services/seasons";
import { requireAuth } from "@/lib/server/session";

export const GET = route(async () => {
  const auth = await requireAuth();
  const current = await getCurrentSeason(auth.db, auth.user.id);
  if (!current) throw new AppError("NOT_FOUND", 404);
  return json(current);
});
