"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client/api";

export function ConsentButton({ version }: { version: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {error ? (
        <p className="notice notice-warn" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api("/me/privacy-consent", { body: { version } });
            router.replace("/");
            router.refresh();
          } catch (err) {
            setError(errorMessage(t, err));
            setBusy(false);
          }
        }}
      >
        {t("consent.accept")}
      </button>
    </>
  );
}
