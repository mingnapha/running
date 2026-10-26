"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { diffLeaderboards, type EntryChange } from "@/lib/domain/leaderboardDiff";
import type { Leaderboard, MyStats as MyStatsDto, Season } from "@/lib/dto";
import { api } from "@/lib/client/api";
import { useFormat } from "@/lib/client/format";
import { useVisiblePolling } from "@/lib/client/hooks";
import { CrownIcon, PlusIcon } from "./icons";
import { LeaderboardTable } from "./LeaderboardTable";
import { MyStats } from "./MyStats";
import { RaceTrack } from "./RaceTrack";

const POLL_MS = 10_000;

interface Props {
  season: Season;
  initial: Leaderboard;
  initialStats: MyStatsDto;
  isParticipant: boolean;
  meId: string;
}

/**
 * หน้าหลักแบบอัปเดตเอง: ถามเลขเวอร์ชันทุก 10 วินาที (เฉพาะตอนเปิดแท็บ) → ถ้าเปลี่ยนจึงดึงตารางใหม่
 * แล้วเทียบกับของเดิมเพื่อเล่นแอนิเมชัน (สลับลู่, แถวเลื่อน, ตัวเลขนับขึ้น, ▲/▼)
 */
export function LiveBoard({ season, initial, initialStats, isParticipant, meId }: Props) {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const f = useFormat();
  const [board, setBoard] = useState(initial);
  const [stats, setStats] = useState(initialStats);
  const [changes, setChanges] = useState<Map<string, EntryChange> | null>(null);
  const [online, setOnline] = useState(true);
  const boardRef = useRef(board);
  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  const poll = useCallback(async () => {
    if (season.status !== "active") return;
    try {
      const { version } = await api<{ version: number }>(`/seasons/${season.id}/leaderboard/version`);
      setOnline(true);
      if (version === boardRef.current.version) return;
      const [next, nextStats] = await Promise.all([
        api<Leaderboard>(`/seasons/${season.id}/leaderboard?v=${version}`),
        api<MyStatsDto>(`/seasons/${season.id}/me/stats`),
      ]);
      setChanges(diffLeaderboards(boardRef.current.entries, next.entries));
      setBoard(next);
      setStats(nextStats);
    } catch {
      setOnline(false);
    }
  }, [season.id, season.status]);

  useVisiblePolling(poll, POLL_MS);

  const leader = board.entries[0];
  return (
    <div className="stack">
      <div className="row">
        <div>
          <h1>{f.locale === "th" ? season.nameTh : season.nameEn}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {t("seasonRange", { start: f.isoDate(season.startDate), end: f.isoDate(season.endDate) })}
          </p>
        </div>
        <span className="spacer" />
        {season.status === "active" ? (
          <span className="row muted" style={{ fontSize: "0.8125rem" }} role="status">
            <span className={`live-dot${online ? "" : " off"}`} aria-hidden="true" />
            {online ? t("updated", { time: f.time(board.generatedAt) }) : t("offline")}
          </span>
        ) : (
          <span className="badge">{t("seasonClosed")}</span>
        )}
      </div>

      {leader ? (
        <section className="leader-banner" aria-label={t("leader")}>
          <span className="crown">
            <CrownIcon />
          </span>
          <div>
            <div className="label">{t("leader")}</div>
            <div className="name">{leader.displayName}</div>
          </div>
          <div className="pts">
            {f.points(leader.totalPoints)}
            <small>
              {f.km(leader.totalDistanceKm)} {tc("km")}
            </small>
          </div>
        </section>
      ) : null}

      <MyStats stats={stats} isParticipant={isParticipant} />

      {season.status === "active" && isParticipant ? (
        <Link href="/runs/new" className="btn btn-accent btn-block">
          <PlusIcon /> {t("recordCta")}
        </Link>
      ) : null}

      <section className="card" aria-labelledby="race-title">
        <div className="card-title">
          <h2 id="race-title">{t("race")}</h2>
        </div>
        {board.entries.length ? <RaceTrack entries={board.entries} meId={meId} /> : <p className="muted">{t("noEntries")}</p>}
      </section>

      <section className="card" aria-labelledby="table-title" style={{ paddingInline: 0 }}>
        <div className="card-title" style={{ paddingInline: "var(--s4)" }}>
          <h2 id="table-title">{t("table")}</h2>
        </div>
        <LeaderboardTable entries={board.entries} unranked={board.unranked} meId={meId} changes={changes} />
      </section>
    </div>
  );
}
