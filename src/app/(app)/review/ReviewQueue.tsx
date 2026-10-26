"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { RunDetail } from "@/lib/dto";
import { api, errorMessage } from "@/lib/client/api";
import { useFormat } from "@/lib/client/format";

type Filter = "all" | "flagged" | "clean";
interface Queue {
  items: RunDetail[];
  totalPending: number;
}

export function ReviewQueue({ initial, seasonId }: { initial: Queue; seasonId: string | null }) {
  const t = useTranslations();
  const [queue, setQueue] = useState(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);

  async function changeFilter(next: Filter) {
    setFilter(next);
    if (!seasonId) return;
    const qs = new URLSearchParams({ seasonId, ...(next === "all" ? {} : { flagged: String(next === "flagged") }) });
    try {
      setQueue(await api<Queue>(`/review/queue?${qs}`));
    } catch (err) {
      setError(errorMessage(t, err));
    }
  }

  function onDecided(id: string) {
    setQueue((q) => ({ items: q.items.filter((x) => x.id !== id), totalPending: Math.max(0, q.totalPending - 1) }));
  }

  return (
    <>
      <div className="row">
        <strong>{t("review.pending", { count: queue.totalPending })}</strong>
        <span className="spacer" />
        <div className="tabs" role="group">
          {(["all", "flagged", "clean"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => changeFilter(k)}>
              {t(k === "all" ? "review.filterAll" : k === "flagged" ? "review.filterFlagged" : "review.filterClean")}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <p className="notice notice-warn" role="alert">
          {error}
        </p>
      ) : null}
      {queue.items.length === 0 ? (
        <p className="card muted">{t("review.empty")}</p>
      ) : (
        <ul className="list">
          {queue.items.map((run) => (
            <ReviewCard key={run.id} run={run} onDecided={onDecided} />
          ))}
        </ul>
      )}
    </>
  );
}

function EvidenceThumb({ url }: { url: string }) {
  const t = useTranslations("review");
  const [missing, setMissing] = useState(false);
  if (missing) return <span className="badge">{t("evidencePurged")}</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" aria-label={t("openImage")}>
      {/* eslint-disable-next-line @next/next/no-img-element -- รูปจาก R2 ผ่าน API ที่ตรวจสิทธิ์ */}
      <img src={url} alt="" className="thumb" loading="lazy" onError={() => setMissing(true)} />
    </a>
  );
}

function ReviewCard({ run, onDecided }: { run: RunDetail; onDecided: (id: string) => void }) {
  const t = useTranslations();
  const f = useFormat();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    setError(null);
    try {
      await api(`/review/runs/${run.id}/decision`, { body: { decision, reason: reason.trim() || undefined } });
      onDecided(run.id);
    } catch (err) {
      setError(errorMessage(t, err));
      setBusy(false);
    }
  }

  return (
    <li className="card run-item">
      <div className="run-head">
        <strong>{run.runner.displayName}</strong>
        <span className="muted num">{run.runner.employeeCode}</span>
        <span className="spacer" />
        <span className="muted">{f.isoDate(run.runDate)}</span>
      </div>
      <div className="run-metrics">
        <strong>
          {f.km(run.distanceKm)} {t("common.km")}
        </strong>
        <span>{f.duration(run.durationSeconds)}</span>
        <span>{t("record.pace", { pace: f.pace(run.paceSecPerKm) })}</span>
      </div>
      {run.flags.length ? (
        <div className="row">
          {run.flags.map((fl) => (
            <span key={fl.code} className="badge badge-flag">
              ⚑ {t(`flags.${fl.code}`)}
            </span>
          ))}
        </div>
      ) : null}
      {run.note ? <p style={{ margin: 0 }}>“{run.note}”</p> : null}
      <div className="thumbs">
        {run.evidence.map((e) =>
          e.url ? (
            <EvidenceThumb key={e.id} url={e.url} />
          ) : (
            <span key={e.id} className="badge">
              {t("review.evidencePurged")}
            </span>
          ),
        )}
      </div>
      <span className="muted" style={{ fontSize: "0.8125rem" }}>
        {t("history.submittedAt", { at: f.dateTime(run.submittedAt) })}
      </span>
      {rejecting ? (
        <div className="field">
          <label htmlFor={`reason-${run.id}`}>{t("review.rejectReason")}</label>
          <textarea
            id={`reason-${run.id}`}
            className="input"
            rows={2}
            maxLength={500}
            value={reason}
            placeholder={t("review.rejectPlaceholder")}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </div>
      ) : null}
      {error ? (
        <p className="notice notice-warn" role="alert">
          {error}
        </p>
      ) : null}
      <div className="row">
        {rejecting ? (
          <>
            <button type="button" className="btn btn-primary" disabled={busy || !reason.trim()} onClick={() => decide("rejected")}>
              {t("review.reject")}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setRejecting(false)}>
              {t("common.cancel")}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-accent" disabled={busy} onClick={() => decide("approved")}>
              {t("review.approve")}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setRejecting(true)}>
              {t("review.reject")}
            </button>
          </>
        )}
      </div>
    </li>
  );
}
