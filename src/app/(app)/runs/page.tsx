import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requirePageAuth } from "@/lib/server/pageAuth";
import { listMyRuns } from "@/lib/server/services/runs";
import { getCurrentSeason } from "@/lib/server/services/seasons";
import { RunHistory } from "./RunHistory";

export const metadata: Metadata = { title: "ประวัติของฉัน" };

export default async function RunsPage() {
  const auth = await requirePageAuth("/runs");
  const current = await getCurrentSeason(auth.db, auth.user.id);
  const first = await listMyRuns(auth, { seasonId: current?.season.id, limit: 20 });
  const t = await getTranslations("history");
  return (
    <div className="stack" style={{ maxWidth: 720, margin: "0 auto" }}>
      <h1>{t("title")}</h1>
      <RunHistory initial={first} seasonId={current?.season.id ?? null} />
    </div>
  );
}
