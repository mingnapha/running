import { requirePageAuth } from "@/lib/server/pageAuth";
import { listDepartments, listUsers } from "@/lib/server/services/admin";
import { getCurrentSeason } from "@/lib/server/services/seasons";
import { UsersAdmin } from "./UsersAdmin";

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const auth = await requirePageAuth("/admin/users", { roles: ["admin"] });
  const { q } = await searchParams;
  const [users, departments, current] = await Promise.all([
    listUsers(auth, { q: q?.slice(0, 60), limit: 100, offset: 0 }),
    listDepartments(auth),
    getCurrentSeason(auth.db, auth.user.id),
  ]);
  return (
    <UsersAdmin
      users={users.items}
      total={users.total}
      departments={departments}
      currentSeasonId={current?.season.status === "active" ? current.season.id : null}
      meId={auth.user.id}
      query={q ?? ""}
    />
  );
}
