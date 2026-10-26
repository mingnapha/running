"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { allowedRunDateRange, computeFlags, previewPace, validateRunSubmission, type RuleViolation } from "@/lib/domain/runRules";
import { computePoints } from "@/lib/domain/scoring";
import type { Run, Season, SeasonRulesDto, UploadedEvidence } from "@/lib/dto";
import { api, errorMessage } from "@/lib/client/api";
import { useFormat } from "@/lib/client/format";
import { compressImage } from "@/lib/client/image";
import { CameraIcon } from "@/components/icons";

interface Photo {
  id: string;
  previewUrl: string;
  uploaded: UploadedEvidence | null;
  error: string | null;
}

const toInt = (v: string) => (v.trim() === "" ? 0 : Number(v));

export function RunForm({ season, rules, today }: { season: Season; rules: SeasonRulesDto; today: string }) {
  const t = useTranslations();
  const f = useFormat();
  const range = allowedRunDateRange(today, rules, season);
  const [runDate, setRunDate] = useState(range?.max ?? today);
  const [distance, setDistance] = useState("");
  const [h, setH] = useState("");
  const [m, setM] = useState("");
  const [s, setS] = useState("");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState<Run | null>(null);
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const fileInput = useRef<HTMLInputElement>(null);

  const distanceKm = Number(distance.replace(",", "."));
  const durationSeconds = toInt(h) * 3600 + toInt(m) * 60 + toInt(s);
  const uploaded = photos.filter((p) => p.uploaded);
  const uploading = photos.some((p) => !p.uploaded && !p.error);

  const violations: RuleViolation[] = useMemo(
    () =>
      validateRunSubmission(
        { runDate, distanceKm: distance ? distanceKm : Number.NaN, durationSeconds },
        { rules, today, season, isParticipant: true, evidenceCount: uploaded.length },
      ),
    [runDate, distance, distanceKm, durationSeconds, rules, today, season, uploaded.length],
  );
  const pace = previewPace(distanceKm, durationSeconds);
  const valid = violations.length === 0;
  const flags = valid ? computeFlags({ runDate, distanceKm, durationSeconds }, rules) : [];

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const room = rules.maxEvidenceFiles - photos.length;
    for (const file of [...files].slice(0, Math.max(0, room))) {
      const id = crypto.randomUUID();
      setPhotos((ps) => [...ps, { id, previewUrl: URL.createObjectURL(file), uploaded: null, error: null }]);
      try {
        const compressed = await compressImage(file);
        const form = new FormData();
        form.append("file", compressed);
        const result = await api<UploadedEvidence>("/uploads/evidence", { form });
        setPhotos((ps) => ps.map((p) => (p.id === id ? { ...p, uploaded: result } : p)));
      } catch (err) {
        setPhotos((ps) => ps.map((p) => (p.id === id ? { ...p, error: errorMessage(t, err) } : p)));
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  function removePhoto(id: string) {
    setPhotos((ps) => {
      const p = ps.find((x) => x.id === id);
      if (p) URL.revokeObjectURL(p.previewUrl);
      return ps.filter((x) => x.id !== id);
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAttempted(true);
    setServerError(null);
    if (!valid || uploading) return;
    setBusy(true);
    try {
      const run = await api<Run>("/runs", {
        body: {
          runDate,
          distanceKm,
          durationSeconds,
          note: note.trim() || undefined,
          evidenceKeys: uploaded.map((p) => p.uploaded!.objectKey),
        },
        headers: { "idempotency-key": idempotencyKey.current },
      });
      setDone(run);
    } catch (err) {
      setServerError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card stack" role="status">
        <h2>✅ {t("record.success")}</h2>
        <div className="run-metrics">
          <span>{f.isoDate(done.runDate)}</span>
          <span>
            {f.km(done.distanceKm)} {t("common.km")}
          </span>
          <span>{f.duration(done.durationSeconds)}</span>
        </div>
        {done.flagCodes.length ? (
          <p className="notice notice-warn">{t("record.flagNotice", { flags: done.flagCodes.map((c) => t(`flags.${c}`)).join(", ") })}</p>
        ) : null}
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            {t("record.another")}
          </button>
          <Link href="/runs" className="btn btn-ghost">
            {t("record.viewHistory")}
          </Link>
        </div>
      </div>
    );
  }

  const errorText = (v: RuleViolation) => t(`errors.${v.code}`, v.details ?? {});

  return (
    <form className="card stack" onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor="runDate">{t("record.date")}</label>
        <input
          id="runDate"
          type="date"
          className="input"
          value={runDate}
          min={range?.min}
          max={range?.max}
          onChange={(e) => setRunDate(e.target.value)}
          required
        />
        <span className="hint">
          {f.isoDate(runDate)} · {t("record.dateHint", { days: rules.maxBackdateDays })}
        </span>
      </div>

      <div className="field">
        <label htmlFor="distance">{t("record.distance")}</label>
        <input
          id="distance"
          className="input num"
          inputMode="decimal"
          placeholder="5.00"
          value={distance}
          onChange={(e) => setDistance(e.target.value)}
          autoComplete="off"
          required
        />
      </div>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">{t("record.duration")}</legend>
        <div className="duration">
          {(
            [
              ["h", h, setH, t("record.hours"), 47],
              ["m", m, setM, t("record.minutes"), 59],
              ["s", s, setS, t("record.seconds"), 59],
            ] as const
          ).map(([key, value, set, label, max]) => (
            <label key={key} className="unit">
              <input className="input num" inputMode="numeric" pattern="[0-9]*" min={0} max={max} value={value} onChange={(e) => set(e.target.value.replace(/\D/g, ""))} aria-label={label} placeholder="0" />
              <span className="muted">{label}</span>
            </label>
          ))}
        </div>
        {pace !== null ? (
          <span className="hint num">
            {t("record.pace", { pace: f.pace(pace) })}
            {Number.isFinite(distanceKm) && distanceKm > 0 ? ` · ${t("record.points", { points: f.points(computePoints(distanceKm, rules.pointsPerKm)) })}` : ""}
          </span>
        ) : null}
      </fieldset>

      <div className="field">
        <span className="label">{t("record.photo")}</span>
        <span className="hint">{t("record.photoHint", { max: rules.maxEvidenceFiles })}</span>
        <div className="photo-picker">
          {photos.map((p) => (
            <div key={p.id} className="photo-slot">
              {/* eslint-disable-next-line @next/next/no-img-element -- รูปตัวอย่างจาก blob: ในเครื่อง */}
              <img src={p.previewUrl} alt="" className="thumb" style={{ opacity: p.uploaded ? 1 : 0.5 }} />
              <button type="button" className="btn btn-ghost btn-sm" style={{ background: "var(--card)" }} onClick={() => removePhoto(p.id)} aria-label={t("record.removePhoto")}>
                ✕
              </button>
              {!p.uploaded && !p.error ? <span className="hint">{t("record.uploading")}</span> : null}
              {p.error ? <span className="hint" role="alert">{p.error}</span> : null}
            </div>
          ))}
          {photos.length < rules.maxEvidenceFiles ? (
            <label className="photo-add">
              <CameraIcon />
              {t("record.addPhoto")}
              <input ref={fileInput} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => addFiles(e.target.files)} />
            </label>
          ) : null}
        </div>
      </div>

      <div className="field">
        <label htmlFor="note">
          {t("record.note")} <span className="muted">{t("common.optional")}</span>
        </label>
        <textarea id="note" className="input" rows={2} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      {attempted && violations.length ? (
        <div className="notice notice-warn" role="alert">
          <ul className="error-list">
            {violations.map((v) => (
              <li key={v.code}>{errorText(v)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {flags.length ? (
        <p className="notice">{t("record.flagNotice", { flags: flags.map((x) => t(`flags.${x.code}`)).join(", ") })}</p>
      ) : null}
      {serverError ? (
        <p className="notice notice-warn" role="alert">
          {serverError}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary btn-block" disabled={busy || uploading}>
        {busy ? t("record.submitting") : uploading ? t("record.uploading") : t("record.submit")}
      </button>
    </form>
  );
}
