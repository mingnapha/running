import { json, route } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { uploadEvidence } from "@/lib/server/services/runs";
import { requireAuth } from "@/lib/server/session";

export const POST = route(async (req) => {
  const auth = await requireAuth();
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION_ERROR", 400, { fields: { file: "required" } });
  return json(await uploadEvidence(auth, file), { status: 201 });
});
