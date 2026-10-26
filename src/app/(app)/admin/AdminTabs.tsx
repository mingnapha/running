"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

export function AdminTabs() {
  const t = useTranslations("admin");
  const path = usePathname();
  const tabs = [
    { href: "/admin", label: t("seasons"), current: path === "/admin" || path.startsWith("/admin/seasons") },
    { href: "/admin/users", label: t("users"), current: path.startsWith("/admin/users") },
  ];
  return (
    <nav className="tabs" aria-label={t("title")}>
      {tabs.map((x) => (
        <Link key={x.href} href={x.href} aria-current={x.current ? "page" : undefined}>
          {x.label}
        </Link>
      ))}
    </nav>
  );
}
