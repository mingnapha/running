import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { formatIsoDate, type Locale } from "@/lib/domain/datetime";
import { requirePageAuth } from "@/lib/server/pageAuth";
import { listSeasons } from "@/lib/server/services/seasons";
import { SeasonForm } from "./SeasonForm";

export default async function AdminSeasonsPage() {
  const { db } = await requirePageAuth("/admin", { roles: ["admin"] });
  const [seasons, t, locale] = await Promise.all([listSeasons(db), getTranslations("admin"), getLocale()]);
  return (
    <div className="grid-2" style={{ alignItems: "start" }}>
      <section className="card">
        <div className="card-title">
          <h2>{t("seasons")}</h2>
        </div>
        <ul className="list">
          {seasons.map((s) => (
            <li key={s.id} className="row">
              <Link href={`/admin/seasons/${s.id}`}>
                <strong>{locale === "th" ? s.nameTh : s.nameEn}</strong>
              </Link>
              <span className={s.status === "active" ? "badge badge-approved" : "badge"}>{t(`seasonStatus.${s.status}`)}</span>
              <span className="muted" style={{ fontSize: "0.8125rem" }}>
                {formatIsoDate(s.startDate, locale as Locale)} – {formatIsoDate(s.endDate, locale as Locale)}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <div className="card-title">
          <h2>{t("newSeason")}</h2>
        </div>
        <SeasonForm />
      </section>
    </div>
  );
}
