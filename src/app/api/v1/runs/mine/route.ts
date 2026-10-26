import { z } from "zod";
import { json, route, searchParams } from "@/lib/server/api";
import { listMyRuns } from "@/lib/server/services/runs";
import { requireAuth } from "@/lib/server/session";

const query = z.object({
  seasonId: z.uuid().optional(),
  status: z.enum(["pending", "approved", "rejected", "cancelled", "revoked"]).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET = route(async (req) => {
  const auth = await requireAuth();
  return json(await listMyRuns(auth, searchParams(req, query)));
});
