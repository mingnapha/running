"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { Role } from "@/lib/domain/types";
import type { Department, UserAdmin } from "@/lib/dto";
import { api, errorMessage } from "@/lib/client/api";

const ROLES: Role[] = ["runner", "approver", "admin"];

interface Props {
  users: UserAdmin[];
  total: number;
  departments: Department[];
  currentSeasonId: string | null;
  meId: string;
  query: string;
}

export function UsersAdmin({ users, total, departments, currentSeasonId, meId, query }: Props) {
  const t = useTranslations();
  const router = useRouter();
  const [secret, setSecret] = useState<{ code: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(errorMessage(t, err));
    }
  }

  return (
    <div className="stack">
      {secret ? <TempPassword code={secret.code} password={secret.password} onClose={() => setSecret(null)} /> : null}
      <div className="grid-2" style={{ alignItems: "start" }}>
        <CreateUser departments={departments} currentSeasonId={currentSeasonId} onCreated={(code, password) => setSecret({ code, password })} />
        <section className="card stack">
          <form className="row" action="/admin/users">
            <input name="q" className="input" defaultValue={query} placeholder={`${t("admin.employeeCode")} / ${t("admin.displayName")}`} style={{ flex: 1 }} />
            <button type="submit" className="btn btn-ghost">
              {t("common.search")}
            </button>
          </form>
          <span className="muted">{t("admin.total", { count: total })}</span>
        </section>
      </div>
      {error ? (
        <p className="notice notice-warn" role="alert">
          {error}
        </p>
      ) : null}
      <section className="card table-wrap" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t("admin.employeeCode")}</th>
              <th>{t("admin.displayName")}</th>
              <th>{t("admin.roles")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                isMe={u.id === meId}
                onRoles={(roles) => act(() => api(`/admin/users/${u.id}/roles`, { method: "PUT", body: { roles } }))}
                onActive={(isActive) => act(() => api(`/admin/users/${u.id}`, { method: "PATCH", body: { isActive } }))}
                onReset={() =>
                  act(async () => {
                    if (!window.confirm(t("admin.resetConfirm", { name: u.displayName }))) return;
                    const r = await api<{ temporaryPassword: string }>(`/admin/users/${u.id}/reset-password`, { method: "POST" });
                    setSecret({ code: u.employeeCode, password: r.temporaryPassword });
                  })
                }
              />
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function UserRow({
  user,
  isMe,
  onRoles,
  onActive,
  onReset,
}: {
  user: UserAdmin;
  isMe: boolean;
  onRoles: (roles: Role[]) => void;
  onActive: (active: boolean) => void;
  onReset: () => void;
}) {
  const t = useTranslations("admin");
  const [roles, setRoles] = useState<Role[]>(user.roles);
  const dirty = roles.slice().sort().join() !== user.roles.slice().sort().join();
  return (
    <tr style={{ opacity: user.isActive ? 1 : 0.55 }}>
      <td className="num">{user.employeeCode}</td>
      <td>
        {user.displayName}
        <div className="row" style={{ marginTop: 4 }}>
          {user.department ? <span className="badge">{user.department.code}</span> : null}
          {!user.isActive ? <span className="badge">{t("inactive")}</span> : null}
          {user.mustChangePassword ? <span className="badge badge-pending">{t("mustChange")}</span> : null}
        </div>
      </td>
      <td>
        <div className="row">
          {ROLES.map((r) => (
            <label key={r} className="row" style={{ gap: 4 }}>
              <input
                type="checkbox"
                checked={roles.includes(r)}
                disabled={isMe && r === "admin"}
                onChange={(e) => setRoles((xs) => (e.target.checked ? [...xs, r] : xs.filter((x) => x !== r)))}
              />
              {t(`role.${r}`)}
            </label>
          ))}
          {dirty ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onRoles(roles)}>
              {t("saveRoles")}
            </button>
          ) : null}
        </div>
      </td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>
          {t("resetPassword")}
        </button>{" "}
        {!isMe ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onActive(!user.isActive)}>
            {user.isActive ? t("deactivate") : t("reactivate")}
          </button>
        ) : null}
      </td>
    </tr>
  );
}

function CreateUser({
  departments,
  currentSeasonId,
  onCreated,
}: {
  departments: Department[];
  currentSeasonId: string | null;
  onCreated: (code: string, password: string) => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: UserAdmin; temporaryPassword: string }>("/admin/users", {
        body: {
          employeeCode: String(fd.get("employeeCode")),
          displayName: String(fd.get("displayName")),
          departmentId: fd.get("departmentId") ? String(fd.get("departmentId")) : null,
          roles: ROLES.filter((r) => fd.get(`role-${r}`) === "on"),
          ...(currentSeasonId && fd.get("addToSeason") === "on" ? { addToSeasonId: currentSeasonId } : {}),
        },
      });
      onCreated(r.user.employeeCode, r.temporaryPassword);
      form.reset();
      router.refresh();
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <h2>{t("admin.newUser")}</h2>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="employeeCode">{t("admin.employeeCode")}</label>
          <input id="employeeCode" name="employeeCode" className="input num" required pattern="[A-Za-z0-9._\-]{3,32}" autoCapitalize="characters" />
        </div>
        <div className="field">
          <label htmlFor="displayName">{t("admin.displayName")}</label>
          <input id="displayName" name="displayName" className="input" required maxLength={60} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="departmentId">{t("admin.department")}</label>
        <select id="departmentId" name="departmentId" className="input" defaultValue="">
          <option value="">{t("admin.noDepartment")}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} — {d.nameTh}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="row" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">{t("admin.roles")}</legend>
        {ROLES.map((r) => (
          <label key={r} className="row" style={{ gap: 4 }}>
            <input type="checkbox" name={`role-${r}`} defaultChecked={r === "runner"} /> {t(`admin.role.${r}`)}
          </label>
        ))}
      </fieldset>
      {currentSeasonId ? (
        <label className="row">
          <input type="checkbox" name="addToSeason" defaultChecked /> {t("admin.addToSeason")}
        </label>
      ) : null}
      {error ? (
        <p className="notice notice-warn" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {t("admin.create")}
      </button>
    </form>
  );
}

function TempPassword({ code, password, onClose }: { code: string; password: string; onClose: () => void }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  return (
    <section className="card stack" role="alert" style={{ outline: "3px solid var(--accent)" }}>
      <h2>{t("admin.tempPassword", { code })}</h2>
      <div className="secret">{password}</div>
      <p className="muted" style={{ margin: 0 }}>
        {t("admin.tempPasswordHint")}
      </p>
      <div className="row">
        <button
          type="button"
          className="btn btn-accent"
          onClick={async () => {
            await navigator.clipboard.writeText(password).catch(() => undefined);
            setCopied(true);
          }}
        >
          {copied ? t("admin.copied") : t("admin.copy")}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
    </section>
  );
}
