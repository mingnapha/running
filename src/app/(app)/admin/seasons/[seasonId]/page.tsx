import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { requirePageAuth } from "@/lib/server/pageAuth";
import { listParticipants } from "@/lib/server/services/admin";
import { getCurrentRules, getSeason } from "@/lib/server/services/seasons";
import { SeasonAdmin } from "./SeasonAdmin";

export default async function AdminSeasonPage({ params }: { params: Promise<{ seasonId: string }> }) {
  const { seasonId } = await params;
  if (!z.uuid().safeParse(seasonId).success) notFound();
  const auth = await requirePageAuth(`/admin/seasons/${seasonId}`, { roles: ["admin"] });
  const season = await getSeason(auth.db, seasonId);
  if (!season) notFound();
  const [rules, participants, locale] = await Promise.all([
    getCurrentRules(auth.db, seasonId),
    listParticipants(auth, seasonId),
    getLocale(),
  ]);
  return <SeasonAdmin season={season} rules={rules} participants={participants} locale={locale as "th" | "en"} />;
}
