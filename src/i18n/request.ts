import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

export const LOCALES = ["th", "en"] as const;
export type AppLocale = (typeof LOCALES)[number];

/** ภาษา: คุกกี้ wr-locale (ตั้งเมื่อผู้ใช้เลือก/ล็อกอิน) → ค่าเริ่มต้นภาษาไทย */
export default getRequestConfig(async () => {
  const value = (await cookies()).get("wr-locale")?.value;
  const locale: AppLocale = value === "en" ? "en" : "th";
  return {
    locale,
    timeZone: "Asia/Bangkok",
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
