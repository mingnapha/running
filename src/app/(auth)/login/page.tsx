import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthHeader } from "@/components/AuthHeader";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Login" };

export default async function LoginPage() {
  const t = await getTranslations();
  return (
    <>
      <AuthHeader title={t("login.title")} tagline={t("app.tagline")} />
      <LoginForm siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""} />
    </>
  );
}
