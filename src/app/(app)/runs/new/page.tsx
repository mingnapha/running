import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { bangkokToday } from "@/lib/domain/datetime";
import { requirePageAuth } from "@/lib/server/pageAuth";
import { getCurrentSeason } from "@/lib/server/services/seasons";
import { RunForm } from "./RunForm";

export const metadata: Metadata = { title: "บันทึกการวิ่ง" };

export default async function NewRunPage() {
  const { db, user } = await requirePageAuth("/runs/new");
  const current = await getCurrentSeason(db, user.id);
  const t = await getTranslations();
  const open = current?.season.status === "active";
  return (
    <div className="stack" style={{ maxWidth: 560, margin: "0 auto" }}>
      <h1>{t("record.title")}</h1>
      {!current || !open ? (
        <p className="card">{t("record.closed")}</p>
      ) : !current.isParticipant ? (
        <p className="card notice notice-warn">{t("stats.notParticipant")}</p>
      ) : (
        <RunForm season={current.season} rules={current.rules} today={bangkokToday()} />
      )}
    </div>
  );
}
