"use client";

import { useLocale } from "next-intl";
import { formatDate, formatDateTime, formatDuration, formatIsoDate, formatPace, formatTime, type Locale } from "@/lib/domain/datetime";

/** ตัวจัดรูปแบบตามภาษาปัจจุบัน — วันที่ พ.ศ. "16 ต.ค. 2569", เวลา "14:25 น." */
export function useFormat() {
  const locale = useLocale() as Locale;
  const nf = new Intl.NumberFormat(locale === "th" ? "th-TH" : "en-US", { maximumFractionDigits: 2 });
  const nf1 = new Intl.NumberFormat(locale === "th" ? "th-TH" : "en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  return {
    locale,
    isoDate: (d: string) => formatIsoDate(d, locale),
    date: (d: string | Date) => formatDate(d, locale),
    time: (d: string | Date) => formatTime(d, locale),
    dateTime: (d: string | Date) => formatDateTime(d, locale),
    duration: formatDuration,
    pace: formatPace,
    points: (n: number) => nf.format(n),
    km: (n: number) => nf1.format(n),
  };
}
