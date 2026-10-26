import { getTranslations } from "next-intl/server";
import { AuthHeader } from "@/components/AuthHeader";
import { unwrap } from "@/lib/server/errors";
import { requirePageAuth } from "@/lib/server/pageAuth";
import { ConsentButton } from "./ConsentButton";

export const dynamic = "force-dynamic";

export default async function ConsentPage() {
  const { db } = await requirePageAuth("/consent", { gate: "consent" });
  const { current_privacy_notice_version: version } = unwrap(
    await db.from("system_settings").select("current_privacy_notice_version").single(),
  ) as { current_privacy_notice_version: string };
  const t = await getTranslations("consent");
  return (
    <>
      <AuthHeader title={t("title")} />
      <section className="card stack">
        <span className="badge" style={{ alignSelf: "flex-start" }}>
          {t("version", { version })}
        </span>
        <p className="prose" style={{ margin: 0 }}>
          {t("body")}
        </p>
        <ConsentButton version={version} />
      </section>
    </>
  );
}
