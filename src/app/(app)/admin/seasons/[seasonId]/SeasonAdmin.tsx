"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { Season, SeasonRulesDto, UserAdmin } from "@/lib/dto";
import { api, errorMessage } from "@/lib/client/api";
import { useFormat } from "@/lib/client/format";

interface Props {
  season: Season;
  rules: SeasonRulesDto;
  participants: UserAdmin[];
  locale: "th" | "en";
}

export function SeasonAdmin({ season, rules, participants, locale }: Props) {
  const t = useTranslations();
  const f = useFormat();
  const router = useRouter();
  const [message, setMessage] = useState<{ kind: "ok" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<string | void>) {
    setBusy(true);
    setMessage(null);
    try {
      const ok = await action();
      if (ok) setMessage({ kind: "ok", text: ok });
      router.refresh();
    } catch (err) {
      setMessage({ kind: "warn", text: errorMessage(t, err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="card stack">
        <div className="row">
          <h2>{locale === "th" ? season.nameTh : season.nameEn}</h2>
          <span className={season.status === "active" ? "badge badge-approved" : "badge"}>{t(`admin.seasonStatus.${season.status}`)}</span>
          <span className="muted">
            {f.isoDate(season.startDate)} – {f.isoDate(season.endDate)}
          </span>
          <span className="spacer" />
          {season.status === "draft" ? (
            <button type="button" className="btn btn-accent" disabled={busy} onClick={() => run(() => api(`/admin/seasons/${season.id}/activate`, { method: "POST" }))}>
              {t("admin.activate")}
            </button>
          ) : null}
          {season.status === "active" ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t("admin.closeConfirm"))) void run(() => api(`/admin/seasons/${season.id}/close`, { body: {} }));
              }}
            >
              {t("admin.close")}
            </button>
          ) : null}
        </div>
        {message ? (
          <p className={`notice${message.kind === "warn" ? " notice-warn" : ""}`} role="status">
            {message.text}
          </p>
        ) : null}
      </section>

      <div className="grid-2" style={{ alignItems: "start" }}>
        <RulesForm season={season} rules={rules} onDone={(text) => setMessage({ kind: "ok", text })} />
        <Participants season={season} participants={participants} />
      </div>
    </div>
  );
}

function RulesForm({ season, rules, onDone }: { season: Season; rules: SeasonRulesDto; onDone: (text: string) => void }) {
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const disabled = season.status === "closed";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const num = (k: string) => Number(String(fd.get(k)).replace(",", "."));
    const opt = (k: string) => (String(fd.get(k) ?? "").trim() === "" ? null : num(k));
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ rules: SeasonRulesDto; recalculatedRuns: number }>(`/admin/seasons/${season.id}/rules`, {
        body: {
          pointsPerKm: num("pointsPerKm"),
          minDistanceKm: num("minDistanceKm"),
          maxBackdateDays: num("maxBackdateDays"),
          maxEvidenceFiles: num("maxEvidenceFiles"),
          flagMinPaceSecPerKm: opt("flagMinPaceSecPerKm"),
          flagMaxPaceSecPerKm: opt("flagMaxPaceSecPerKm"),
          flagMaxDistanceKm: opt("flagMaxDistanceKm"),
          flagMaxDailyKm: opt("flagMaxDailyKm"),
          changeReason: String(fd.get("changeReason") ?? ""),
          recalculate: fd.get("recalculate") === "on",
        },
      });
      onDone(t("admin.rulesSaved", { version: res.rules.version, count: res.recalculatedRuns }));
      router.refresh();
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  const field = (name: keyof SeasonRulesDto, label: string, step: string, hint?: string) => (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <input id={name} name={name} className="input num" inputMode="decimal" step={step} defaultValue={rules[name] === null ? "" : String(rules[name])} disabled={disabled} />
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );

  return (
    <form className="card stack" onSubmit={onSubmit} key={rules.id}>
      <div className="card-title">
        <h2>{t("admin.rules")}</h2>
        <span className="badge">{t("admin.rulesVersion", { version: rules.version })}</span>
      </div>
      <div className="grid-2">
        {field("pointsPerKm", t("admin.pointsPerKm"), "0.01")}
        {field("minDistanceKm", t("admin.minDistanceKm"), "0.01")}
        {field("maxBackdateDays", t("admin.maxBackdateDays"), "1")}
        {field("maxEvidenceFiles", t("admin.maxEvidenceFiles"), "1")}
        {field("flagMinPaceSecPerKm", t("admin.flagMinPace"), "1", t("admin.flagOffHint"))}
        {field("flagMaxPaceSecPerKm", t("admin.flagMaxPace"), "1", t("admin.flagOffHint"))}
        {field("flagMaxDistanceKm", t("admin.flagMaxDistance"), "0.01", t("admin.flagOffHint"))}
        {field("flagMaxDailyKm", t("admin.flagMaxDaily"), "0.01", t("admin.flagOffHint"))}
      </div>
      <div className="field">
        <label htmlFor="changeReason">{t("admin.changeReason")}</label>
        <input id="changeReason" name="changeReason" className="input" required maxLength={500} disabled={disabled} />
      </div>
      <label className="row">
        <input type="checkbox" name="recalculate" disabled={disabled || season.status !== "active"} /> {t("admin.recalculate")}
      </label>
      {error ? (
        <p className="notice notice-warn" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={busy || disabled}>
        {t("admin.saveRules")}
      </button>
    </form>
  );
}

function Participants({ season, participants }: { season: Season; participants: UserAdmin[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [codes, setCodes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    const list = codes.split(/[\s,;]+/).filter(Boolean);
    if (!list.length) return;
    setBusy(true);
    try {
      const r = await api<{ added: number; alreadyPresent: number; notFound: string[] }>(`/admin/seasons/${season.id}/participants`, {
        body: { employeeCodes: list },
      });
      setMessage(
        [t("admin.addResult", { added: r.added, already: r.alreadyPresent }), r.notFound.length ? t("admin.notFound", { codes: r.notFound.join(", ") }) : ""]
          .filter(Boolean)
          .join(" · "),
      );
      setCodes("");
      router.refresh();
    } catch (err) {
      setMessage(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(u: UserAdmin) {
    if (!window.confirm(t("admin.removeConfirm", { name: u.displayName }))) return;
    try {
      await api(`/admin/seasons/${season.id}/participants/${u.id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setMessage(errorMessage(t, err));
    }
  }

  return (
    <section className="card stack">
      <div className="card-title">
        <h2>{t("admin.participants")}</h2>
        <span className="badge">{t("admin.total", { count: participants.length })}</span>
      </div>
      {season.status !== "closed" ? (
        <div className="field">
          <label htmlFor="codes">{t("admin.addCodes")}</label>
          <textarea id="codes" className="input num" rows={3} value={codes} onChange={(e) => setCodes(e.target.value)} />
          <button type="button" className="btn btn-primary" disabled={busy || !codes.trim()} onClick={add}>
            {t("admin.add")}
          </button>
        </div>
      ) : null}
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t("admin.employeeCode")}</th>
              <th>{t("admin.displayName")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {participants.map((u) => (
              <tr key={u.id}>
                <td className="num">{u.employeeCode}</td>
                <td>{u.displayName}</td>
                <td style={{ textAlign: "right" }}>
                  {season.status !== "closed" ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(u)}>
                      {t("admin.remove")}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
