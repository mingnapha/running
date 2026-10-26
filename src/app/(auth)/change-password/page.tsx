import { getTranslations } from "next-intl/server";
import { AuthHeader } from "@/components/AuthHeader";
import { requirePageAuth } from "@/lib/server/pageAuth";
import { ChangePasswordForm } from "./ChangePasswordForm";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const { user } = await requirePageAuth("/change-password", { gate: "password" });
  const t = await getTranslations("changePassword");
  return (
    <>
      <AuthHeader title={t("title")} />
      <ChangePasswordForm employeeCode={user.employeeCode} next={user.needsConsent ? "/consent" : "/"} />
    </>
  );
}
