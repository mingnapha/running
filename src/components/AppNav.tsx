"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Role } from "@/lib/domain/types";
import { api } from "@/lib/client/api";
import { CheckIcon, ListIcon, PlusIcon, RunnerIcon, ShieldIcon, TrophyIcon } from "./icons";

interface Props {
  roles: Role[];
  displayName: string;
  locale: "th" | "en";
}

export function AppNav({ roles, displayName, locale }: Props) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const router = useRouter();
  const isReviewer = roles.includes("approver") || roles.includes("admin");
  const isAdmin = roles.includes("admin");
  const links = [
    { href: "/", label: t("home"), icon: <TrophyIcon /> },
    { href: "/runs/new", label: t("record"), icon: <PlusIcon />, primary: true },
    { href: "/runs", label: t("history"), icon: <ListIcon /> },
    ...(isReviewer ? [{ href: "/review", label: t("review"), icon: <CheckIcon /> }] : []),
    ...(isAdmin ? [{ href: "/admin", label: t("admin"), icon: <ShieldIcon /> }] : []),
  ];
  // "/runs" ต้องไม่ติดสถานะเมื่ออยู่ที่ "/runs/new"
  const isCurrent = (href: string) =>
    href === "/" || href === "/runs" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  async function switchLanguage() {
    await api("/me", { method: "PATCH", body: { locale: locale === "th" ? "en" : "th" } }).catch(() => undefined);
    router.refresh();
  }
  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            <span className="brand-mark">
              <RunnerIcon />
            </span>
            workingRun
          </Link>
          <nav className="nav-desktop" aria-label={t("menu")}>
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="nav-link" aria-current={isCurrent(l.href) ? "page" : undefined}>
                {l.label}
              </Link>
            ))}
          </nav>
          <span className="spacer" />
          <span className="topbar-user muted">{displayName}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={switchLanguage} lang={locale === "th" ? "en" : "th"}>
            {t("language")}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
            {t("logout")}
          </button>
        </div>
      </header>
      <nav className="nav-mobile" aria-label={t("menu")}>
        {links.map((l) => (
          <Link key={l.href} href={l.href} aria-current={isCurrent(l.href) ? "page" : undefined} className={l.primary ? "nav-primary" : undefined}>
            <span className="icon">{l.icon}</span>
            {l.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
