"use client";

import { useTranslations } from "next-intl";
import { computeRace } from "@/lib/domain/raceTrack";
import type { LeaderboardEntry } from "@/lib/dto";
import { useFormat } from "@/lib/client/format";
import { RunnerIcon } from "./icons";

interface Props {
  entries: LeaderboardEntry[];
  meId: string;
}

/**
 * สนามแข่ง 5 อันดับแรก — นักวิ่งอยู่บนลู่ตามสัดส่วนคะแนนเทียบผู้นำ และสลับลู่เมื่ออันดับเปลี่ยน
 * DOM เรียงตาม userId (คงที่) เพื่อให้ CSS transition เล่นได้ ส่วนข้อมูลจริงสำหรับ screen reader อยู่ในตารางคะแนน
 */
export function RaceTrack({ entries, meId }: Props) {
  const t = useTranslations("home");
  const f = useFormat();
  const race = computeRace(entries);

  if (race.length === 0) return null;
  const leader = race[0]!;
  const stable = [...race].sort((a, b) => (a.userId < b.userId ? -1 : 1));

  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="sr-only">{t("raceSummary", { name: leader.displayName, points: f.points(leader.totalPoints) })}</figcaption>
      <div className="race" style={{ "--lanes": race.length } as React.CSSProperties} aria-hidden="true">
        {stable.map((r) => (
          <div
            key={r.userId}
            className={`race-lane${r.isLeader ? " is-leader" : ""}${r.userId === meId ? " is-me" : ""}`}
            data-side={r.progress > 0.45 ? "left" : "right"}
            style={{ "--lane": r.lane, "--p": r.progress } as React.CSSProperties}
          >
            <span className="race-medal" data-medal={r.rank <= 3 ? r.rank : undefined}>
              {r.rank}
            </span>
            <div className="race-track">
              <div className="race-fill" />
              <div className="race-runner">
                {/* key เปลี่ยนเมื่อแต้มเปลี่ยน → token ถูกสร้างใหม่ แอนิเมชันก้าวขาเล่น 1 รอบ (ปิดเมื่อ reduced motion) */}
                <span className="race-token" key={r.totalPoints}>
                  <RunnerIcon />
                </span>
                <span className="race-name">{r.displayName}</span>
                <span className="race-points">{f.points(r.totalPoints)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}
