import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requirePageAuth } from "@/lib/server/pageAuth";
import { getReviewQueue } from "@/lib/server/services/review";
import { getCurrentSeason } from "@/lib/server/services/seasons";
import { ReviewQueue } from "./ReviewQueue";

export const metadata: Metadata = { title: "ตรวจสอบ" };

export default async function ReviewPage() {
  const auth = await requirePageAuth("/review", { roles: ["approver", "admin"] });
  const t = await getTranslations("review");
  const current = await getCurrentSeason(auth.db, auth.user.id);
  const queue = current ? await getReviewQueue(auth, { seasonId: current.season.id }) : { items: [], totalPending: 0 };
  return (
    <div className="stack" style={{ maxWidth: 820, margin: "0 auto" }}>
      <h1>{t("title")}</h1>
      <ReviewQueue initial={queue} seasonId={current?.season.id ?? null} />
    </div>
  );
}
