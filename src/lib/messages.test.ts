import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import th from "../../messages/th.json";

type Tree = { [k: string]: string | Tree };
function keys(t: Tree, prefix = ""): string[] {
  return Object.entries(t).flatMap(([k, v]) => (typeof v === "string" ? [prefix + k] : keys(v, `${prefix}${k}.`)));
}

const root = join(__dirname, "..", "..");
const sql = readdirSync(join(root, "supabase/migrations"))
  .map((f) => readFileSync(join(root, "supabase/migrations", f), "utf8"))
  .join("\n");
const dbCodes = [...new Set([...sql.matchAll(/raise_app_error\('([A-Z_]+)'/g)].map((m) => m[1]!))];
const serverSources = [
  ...readdirSync(join(root, "src/lib/server/services")).map((f) => join(root, "src/lib/server/services", f)),
  join(root, "src/lib/server/errors.ts"),
  join(root, "src/lib/server/api.ts"),
]
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");
const apiCodes = [...new Set([...serverSources.matchAll(/AppError\("([A-Z_]+)"/g)].map((m) => m[1]!))];

describe("ข้อความ 2 ภาษา", () => {
  it("ภาษาไทยและอังกฤษมี key ตรงกันทุกตัว", () => {
    expect(keys(en as Tree).sort()).toEqual(keys(th as Tree).sort());
  });

  it("ไม่มีข้อความว่าง", () => {
    for (const tree of [th, en] as Tree[]) {
      for (const k of keys(tree)) {
        const v = k.split(".").reduce<string | Tree>((acc, part) => (acc as Tree)[part]!, tree);
        expect(v, k).not.toBe("");
      }
    }
  });

  it("ทุกรหัส error จากฐานข้อมูลและ API มีข้อความแปล", () => {
    expect(dbCodes.length).toBeGreaterThan(20);
    const translated = new Set(Object.keys((th as Tree).errors as Tree));
    const missing = [...dbCodes, ...apiCodes].filter((c) => !translated.has(c));
    expect(missing).toEqual([]);
  });
});
