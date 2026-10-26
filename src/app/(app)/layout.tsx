import { AppNav } from "@/components/AppNav";
import { requirePageAuth } from "@/lib/server/pageAuth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // layout ไม่รู้ path ของหน้า — หน้าแต่ละหน้าเรียก requirePageAuth(path) เองด้วย เพื่อกลับหน้าเดิมหลังต่ออายุ session
  const { user } = await requirePageAuth("/");
  return (
    <>
      <AppNav roles={user.roles} displayName={user.displayName} locale={user.locale} />
      <main className="shell">{children}</main>
    </>
  );
}
