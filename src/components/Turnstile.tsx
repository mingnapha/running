"use client";

import { useLocale } from "next-intl";
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, opts: Record<string, unknown>): string;
      remove(id: string): void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
  return new Promise((resolve, reject) => {
    const s = existing ?? Object.assign(document.createElement("script"), { src: SCRIPT_SRC, async: true, defer: true });
    s.addEventListener("load", () => resolve());
    s.addEventListener("error", () => reject(new Error("turnstile load failed")));
    if (!existing) document.head.appendChild(s);
  });
}

/** Cloudflare Turnstile (กันสแปม/บอท) — ส่ง token ให้ฟอร์มล็อกอิน */
export function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const locale = useLocale();

  useEffect(() => {
    let widget: string | undefined;
    let cancelled = false;
    void loadScript().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return;
      widget = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        language: locale,
        size: "flexible",
        callback: (token: string) => onToken(token),
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null),
      });
    });
    return () => {
      cancelled = true;
      if (widget && window.turnstile) window.turnstile.remove(widget);
    };
  }, [siteKey, locale, onToken]);

  return <div ref={ref} style={{ minHeight: 65 }} />;
}
