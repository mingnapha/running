import { getTranslations } from "next-intl/server";
import { LiveBoard } from "@/components/LiveBoard";
import { getLeaderboard, getMyStats } from "@/lib/server/services/leaderboard";
import { getCurrentSeason } from "@/lib/server/services/seasons";
import { requirePageAuth } from "@/lib/server/pageAuth";

export default async function HomePage() {
  const { db, user } = await requirePageAuth("/");
  const current = await getCurrentSeason(db, user.id);
  if (!current) {
    const t = await getTranslations("home");
    return (
      <div className="card">
        <p>{t("noSeason")}</p>
      </div>
    );
  }
  const [board, stats] = await Promise.all([getLeaderboard(db, current.season.id), getMyStats(db, current.season.id, user.id)]);
  return <LiveBoard season={current.season} initial={board} initialStats={stats} isParticipant={current.isParticipant} meId={user.id} />;
}
