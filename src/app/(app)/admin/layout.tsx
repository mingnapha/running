import { getTranslations } from "next-intl/server";
import { requirePageAuth } from "@/lib/server/pageAuth";
import { AdminTabs } from "./AdminTabs";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePageAuth("/admin", { roles: ["admin"] });
  const t = await getTranslations("admin");
  return (
    <div className="stack">
      <h1>{t("title")}</h1>
      <AdminTabs />
      {children}
    </div>
  );
}
