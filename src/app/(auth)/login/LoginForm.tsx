"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Turnstile } from "@/components/Turnstile";
import { api, errorMessage } from "@/lib/client/api";
import type { Me } from "@/lib/dto";

export function LoginForm({ siteKey }: { siteKey: string }) {
  const t = useTranslations();
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const me = await api<Me>("/auth/login", {
        body: { username: String(form.get("username")), password: String(form.get("password")), turnstileToken: token },
      });
      window.location.assign(me.mustChangePassword ? "/change-password" : me.needsConsent ? "/consent" : "/");
    } catch (err) {
      setError(errorMessage(t, err));
      setToken(null);
      setResetKey((k) => k + 1); // token ของ Turnstile ใช้ได้ครั้งเดียว
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor="username">{t("login.username")}</label>
        <input id="username" name="username" className="input" autoComplete="username" autoCapitalize="characters" required inputMode="text" />
      </div>
      <div className="field">
        <label htmlFor="password">{t("login.password")}</label>
        <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
      </div>
      <Turnstile key={resetKey} siteKey={siteKey} onToken={setToken} />
      {error ? (
        <p className="notice notice-warn" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !token}>
        {busy ? t("login.submitting") : token ? t("login.submit") : t("login.verifying")}
      </button>
      <p className="muted" style={{ fontSize: "0.875rem", margin: 0 }}>
        {t("login.forgot")}
      </p>
    </form>
  );
}
