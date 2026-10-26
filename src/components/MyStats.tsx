"use client";

import { useTranslations } from "next-intl";
import type { MyStats as MyStatsDto } from "@/lib/dto";
import { useFormat } from "@/lib/client/format";
import { useCountUp } from "@/lib/client/hooks";

export function MyStats({ stats, isParticipant }: { stats: MyStatsDto; isParticipant: boolean }) {
  const t = useTranslations("stats");
  const tc = useTranslations("common");
  const f = useFormat();
  const distance = useCountUp(stats.totalDistanceKm);
  const points = useCountUp(stats.totalPoints);

  return (
    <section className="card" aria-labelledby="my-stats">
      <div className="card-title">
        <h2 id="my-stats">{t("title")}</h2>
      </div>
      {!isParticipant ? <p className="notice notice-warn">{t("notParticipant")}</p> : null}
      <div className="stats-grid">
        <div className="stat">
          <div className="stat-label">{t("rank")}</div>
          <div className="stat-value">{stats.rank ?? tc("none")}</div>
          <div className="stat-sub">{t("of", { count: stats.participantCount })}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{t("distance")}</div>
          <div className="stat-value">{f.km(distance)}</div>
          <div className="stat-sub">{tc("km")}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{t("runs")}</div>
          <div className="stat-value">{stats.approvedRunCount}</div>
          <div className="stat-sub">{stats.pendingRunCount > 0 ? t("pending", { count: stats.pendingRunCount, km: f.km(stats.pendingDistanceKm) }) : " "}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{t("points")}</div>
          <div className="stat-value">{f.points(points)}</div>
          <div className="stat-sub">
            {stats.rank === 1 ? t("leading") : stats.pointsToNextRank !== null ? t("gap", { points: f.points(stats.pointsToNextRank) }) : " "}
          </div>
        </div>
      </div>
    </section>
  );
}
