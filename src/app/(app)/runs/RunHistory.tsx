"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { Paged, Run } from "@/lib/dto";
import { api, errorMessage } from "@/lib/client/api";
import { useFormat } from "@/lib/client/format";

export function StatusBadge({ status }: { status: Run["status"] }) {
  const t = useTranslations("status");
  const cls = status === "approved" ? "badge badge-approved" : status === "pending" ? "badge badge-pending" : "badge";
  return <span className={cls}>{t(status)}</span>;
}

export function RunHistory({ initial, seasonId }: { initial: Paged<Run>; seasonId: string | null }) {
  const t = useTranslations();
  const f = useFormat();
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function loadMore() {
    if (!cursor) return;
    setBusy("more");
    try {
      const qs = new URLSearchParams({ cursor, ...(seasonId ? { seasonId } : {}) });
      const page = await api<Paged<Run>>(`/runs/mine?${qs}`);
      setItems((xs) => [...xs, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(null);
    }
  }

  async function cancel(run: Run) {
    if (!window.confirm(t("history.cancelConfirm"))) return;
    setBusy(run.id);
    try {
      await api(`/runs/${run.id}/cancel`, { method: "POST" });
      setItems((xs) => xs.map((x) => (x.id === run.id ? { ...x, status: "cancelled" } : x)));
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) return <p className="card muted">{t("history.empty")}</p>;

  return (
    <>
      {error ? (
        <p className="notice notice-warn" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="list">
        {items.map((r) => (
          <li key={r.id} className="card run-item">
            <div className="run-head">
              <strong>{f.isoDate(r.runDate)}</strong>
              <StatusBadge status={r.status} />
              {r.flagCodes.map((c) => (
                <span key={c} className="badge badge-flag">
                  {t(`flags.${c}`)}
                </span>
              ))}
              <span className="spacer" />
              {r.points !== null && r.points > 0 ? <strong className="num">+{f.points(r.points)}</strong> : null}
            </div>
            <div className="run-metrics">
              <span>
                {f.km(r.distanceKm)} {t("common.km")}
              </span>
              <span>{f.duration(r.durationSeconds)}</span>
              <span className="muted">{t("record.pace", { pace: f.pace(r.paceSecPerKm) })}</span>
            </div>
            {r.latestReview?.reason && r.status !== "approved" ? (
              <p className="notice notice-warn" style={{ margin: 0 }}>
                {t("history.reason", { reason: r.latestReview.reason })}
              </p>
            ) : null}
            <div className="row muted" style={{ fontSize: "0.8125rem" }}>
              <span>{t("history.submittedAt", { at: f.dateTime(r.submittedAt) })}</span>
              <span className="spacer" />
              {r.status === "pending" ? (
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy === r.id} onClick={() => cancel(r)}>
                  {t("history.cancel")}
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {cursor ? (
        <button type="button" className="btn btn-ghost" onClick={loadMore} disabled={busy === "more"}>
          {t("history.loadMore")}
        </button>
      ) : null}
    </>
  );
}
