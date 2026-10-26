import { z } from "zod";
import { json, readJson, route, searchParams } from "@/lib/server/api";
import { createUser, listUsers } from "@/lib/server/services/admin";
import { requireAuth } from "@/lib/server/session";
import { userCreateSchema } from "@/lib/validation";

const query = z.object({
  q: z.string().trim().max(60).optional(),
  active: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.coerce.number().int().min(0).optional(),
});

export const GET = route(async (req) => {
  const auth = await requireAuth({ roles: ["admin"] });
  const q = searchParams(req, query);
  const offset = q.cursor ?? 0;
  const { items, total } = await listUsers(auth, { q: q.q, active: q.active, limit: q.limit, offset });
  const next = offset + items.length;
  return json({ items, total, nextCursor: next < total ? String(next) : null });
});

export const POST = route(async (req) => {
  const auth = await requireAuth({ roles: ["admin"] });
  return json(await createUser(auth, await readJson(req, userCreateSchema)), { status: 201 });
});
