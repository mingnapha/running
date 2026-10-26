import { noContent, route } from "@/lib/server/api";
import { logout } from "@/lib/server/services/auth";

export const POST = route(async () => {
  await logout();
  return noContent();
});
