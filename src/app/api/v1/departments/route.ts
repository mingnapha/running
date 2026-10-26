import { json, route } from "@/lib/server/api";
import { listDepartments } from "@/lib/server/services/admin";
import { requireAuth } from "@/lib/server/session";

export const GET = route(async () => {
  const auth = await requireAuth();
  return json({ items: await listDepartments(auth) });
});
