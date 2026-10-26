"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { checkPassword, type PasswordProblem } from "@/lib/domain/password";
import { api, ApiError, errorMessage } from "@/lib/client/api";

export function ChangePasswordForm({ employeeCode, next }: { employeeCode: string; next: string }) {
  const t = useTranslations();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problems = password ? checkPassword(password, employeeCode, current || undefined) : [];
  const mismatch = confirm.length > 0 && confirm !== password;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (problems.length || mismatch || !password) return;
    setBusy(true);
    setError(null);
    try {
      await api("/auth/change-password", { body: { currentPassword: current, newPassword: password } });
      window.location.assign(next);
    } catch (err) {
      if (err instanceof ApiError && err.code === "WEAK_PASSWORD") {
        const list = (err.details.problems as PasswordProblem[] | undefined) ?? [];
        setError(list.map((p) => t(`changePassword.problems.${p}`)).join(" · "));
      } else {
        setError(errorMessage(t, err));
      }
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <p className="muted" style={{ margin: 0 }}>
        {t("changePassword.intro")}
      </p>
      <div className="field">
        <label htmlFor="current">{t("changePassword.current")}</label>
        <input id="current" type="password" className="input" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="new">{t("changePassword.new")}</label>
        <input id="new" type="password" className="input" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="pw-rules" required />
        <span id="pw-rules" className="hint">
          {t("changePassword.rules")}
        </span>
        {problems.length ? (
          <ul className="error-list hint" aria-live="polite">
            {problems.map((p) => (
              <li key={p}>{t(`changePassword.problems.${p}`)}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="confirm">{t("changePassword.confirm")}</label>
        <input id="confirm" type="password" className="input" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        {mismatch ? <span className="hint">{t("changePassword.mismatch")}</span> : null}
      </div>
      {error ? (
        <p className="notice notice-warn" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !password || problems.length > 0 || confirm !== password}>
        {t("changePassword.submit")}
      </button>
    </form>
  );
}
