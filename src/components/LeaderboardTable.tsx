"use client";

import { useTranslations } from "next-intl";
import { rankMovement } from "@/lib/domain/ranking";
import type { EntryChange } from "@/lib/domain/leaderboardDiff";
import type { LeaderboardEntry } from "@/lib/dto";
import { useFormat } from "@/lib/client/format";
import { useCountUp, useFlip, useReducedMotion } from "@/lib/client/hooks";

interface Props {
  entries: LeaderboardEntry[];
  unranked: { userId: string; displayName: string }[];
  meId: string;
  /** การเปลี่ยนแปลงที่หน้าเว็บเห็นเอง (ระหว่างเปิดหน้า) — ใช้แทน previousRank จากฐานข้อมูล */
  changes: Map<string, EntryChange> | null;
}

function Points({ value }: { value: number }) {
  const f = useFormat();
  return <>{f.points(useCountUp(value))}</>;
}

function Movement({ rank, previousRank, isNew }: { rank: number; previousRank: number | null; isNew: boolean }) {
  const t = useTranslations("home");
  if (isNew) return <span className="badge badge-new">{t("new")}</span>;
  // previousRank = null จากฐานข้อมูล (เข้าตารางก่อนเปิดหน้านี้) ไม่ต้องแสดงป้าย
  if (previousRank === null) return null;
  const m = rankMovement(rank, previousRank);
  if (m.kind === "up") return <span className="badge badge-up">{t("up", { n: m.by })}</span>;
  if (m.kind === "down") return <span className="badge badge-down">{t("down", { n: m.by })}</span>;
  return null;
}

export function LeaderboardTable({ entries, unranked, meId, changes }: Props) {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const f = useFormat();
  const reduced = useReducedMotion();
  const ref = useFlip(
    entries.map((e) => e.userId),
    !reduced,
  );
  const leaderPoints = entries[0]?.totalPoints ?? 0;

  return (
    <>
      <div className="lb-head" aria-hidden="true">
        <span>{t("colRank")}</span>
        <span>{t("colName")}</span>
        <span className="lb-col">{t("colDistance")}</span>
        <span className="lb-col">{t("colRuns")}</span>
        <span style={{ textAlign: "right" }}>{t("colPoints")}</span>
      </div>
      <ol className="lb" aria-label={t("table")}>
        {entries.map((e) => {
          const change = changes?.get(e.userId);
          // ระหว่างเปิดหน้า: ใช้การเปลี่ยนที่หน้าเว็บเห็นเอง ไม่งั้นใช้ previousRank จากฐานข้อมูล
          const liveMove = change !== undefined && change.rankDelta !== 0;
          const isNew = change !== undefined && change.fromRank === null;
          const previousRank = liveMove ? change.fromRank : e.previousRank;
          const isMe = e.userId === meId;
          return (
            <li
              key={e.userId}
              ref={ref(e.userId)}
              className={`lb-row${e.rank === 1 ? " is-leader" : ""}${isMe ? " is-me" : ""}${change?.pointsChanged && changes ? " flash" : ""}`}
              aria-current={isMe ? "true" : undefined}
            >
              <span className="lb-rank" data-medal={e.rank <= 3 ? e.rank : undefined}>
                {e.rank}
              </span>
              <div className="lb-name">
                <strong>
                  {e.displayName}
                  {isMe ? <span className="muted"> · {t("you")}</span> : null}
                </strong>
                <div className="meta">
                  {e.department ? <span>{e.department.code}</span> : null}
                  <Movement rank={e.rank} previousRank={previousRank} isNew={isNew} />
                  <span className="lb-mobile-sub">
                    {f.km(e.totalDistanceKm)} {tc("km")} · {e.approvedRunCount}×
                  </span>
                </div>
                <div className="lb-bar" aria-hidden="true">
                  <span style={{ "--p": leaderPoints ? e.totalPoints / leaderPoints : 0 } as React.CSSProperties} />
                </div>
              </div>
              <span className="lb-col">{f.km(e.totalDistanceKm)}</span>
              <span className="lb-col">{e.approvedRunCount}</span>
              <span className="lb-points">
                <Points value={e.totalPoints} />
              </span>
            </li>
          );
        })}
      </ol>
      {unranked.length > 0 ? (
        <details className="unranked">
          <summary>{t("unranked", { count: unranked.length })}</summary>
          <ul>
            {unranked.map((u) => (
              <li key={u.userId}>{u.displayName}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
