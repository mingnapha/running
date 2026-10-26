import { json, readJson, route } from "@/lib/server/api";
import { login } from "@/lib/server/services/auth";
import { writeLocale } from "@/lib/server/session";
import { loginSchema } from "@/lib/validation";

export const POST = route(async (req) => {
  const input = await readJson(req, loginSchema);
  const user = await login(input, req.headers);
  await writeLocale(user.locale);
  return json(user);
});
