"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { Season } from "@/lib/dto";
import { api, errorMessage } from "@/lib/client/api";

export function SeasonForm() {
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const season = await api<Season>("/admin/seasons", {
        body: Object.fromEntries(["nameTh", "nameEn", "startDate", "endDate"].map((k) => [k, String(form.get(k) ?? "")])),
      });
      router.push(`/admin/seasons/${season.id}`);
    } catch (err) {
      setError(errorMessage(t, err));
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="nameTh">{t("admin.nameTh")}</label>
        <input id="nameTh" name="nameTh" className="input" required maxLength={100} placeholder="ฤดูกาล 1/2570" />
      </div>
      <div className="field">
        <label htmlFor="nameEn">{t("admin.nameEn")}</label>
        <input id="nameEn" name="nameEn" className="input" required maxLength={100} placeholder="Season 1/2027" />
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="startDate">{t("admin.startDate")}</label>
          <input id="startDate" name="startDate" type="date" className="input" required />
        </div>
        <div className="field">
          <label htmlFor="endDate">{t("admin.endDate")}</label>
          <input id="endDate" name="endDate" type="date" className="input" required />
        </div>
      </div>
      {error ? (
        <p className="notice notice-warn" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {t("admin.newSeason")}
      </button>
    </form>
  );
}
