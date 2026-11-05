import { describe, expect, it } from "vitest";
import { runDailyJobs, type CronBucket, type CronDb } from "./jobs";

const NOW = new Date("2026-10-26T20:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

function setup() {
  const objects = new Map<string, Date>([
    ["evidence/u1/expired.webp", hoursAgo(24 * 91)],
    ["evidence/u1/active.webp", hoursAgo(24 * 3)],
    ["evidence/u2/orphan-old.webp", hoursAgo(30)],
    ["evidence/u2/orphan-new.webp", hoursAgo(2)],
  ]);
  const evidence = [
    { id: "e1", object_key: "evidence/u1/expired.webp", storage_provider: "r2", due: true, purged: false },
    { id: "e2", object_key: "evidence/u1/active.webp", storage_provider: "r2", due: false, purged: false },
  ];
  const db: CronDb = {
    dueEvidence: async (limit) => evidence.filter((e) => e.due && !e.purged).slice(0, limit),
    markPurged: async (ids) => {
      let n = 0;
      for (const e of evidence) {
        if (ids.includes(e.id) && !e.purged) {
          e.purged = true;
          n++;
        }
      }
      return n;
    },
    existingKeys: async (keys) => new Set(evidence.map((e) => e.object_key).filter((k) => keys.includes(k))),
    purgeAuditLogs: async () => 3,
  };
  const bucket: CronBucket = {
    provider: "r2",
    delete: async (keys) => keys.forEach((k) => objects.delete(k)),
    list: async () => ({ objects: [...objects].map(([key, uploaded]) => ({ key, uploaded })), truncated: false }),
  };
  return { db, bucket, objects, evidence };
}

describe("runDailyJobs", () => {
  it("รูปที่อยู่ในที่เก็บอีกแบบ ลบด้วยที่เก็บของมันเอง", async () => {
    const { db, bucket, evidence } = setup();
    evidence.push({ id: "e3", object_key: "evidence/u3/sb.webp", storage_provider: "supabase", due: true, purged: false });
    const deleted: string[] = [];
    const sb: CronBucket = { provider: "supabase", delete: async (k) => void deleted.push(...k), list: async () => ({ objects: [], truncated: false }) };
    const r = await runDailyJobs(db, [bucket, sb], NOW);
    expect(r.purgedEvidence).toBe(2);
    expect(deleted).toEqual(["evidence/u3/sb.webp"]);
  });

  it("รูปในที่เก็บที่ไม่ได้เชื่อมไว้ จะไม่ถูกทำเครื่องหมายว่าลบแล้ว", async () => {
    const { db, evidence } = setup();
    const sb: CronBucket = { provider: "supabase", delete: async () => undefined, list: async () => ({ objects: [], truncated: false }) };
    await runDailyJobs(db, [sb], NOW);
    expect(evidence.find((e) => e.id === "e1")!.purged).toBe(false);
  });

  it("ลบรูปที่ครบ 90 วัน และทำเครื่องหมายในฐานข้อมูล", async () => {
    const { db, bucket, objects, evidence } = setup();
    const r = await runDailyJobs(db, [bucket], NOW);
    expect(r.purgedEvidence).toBe(1);
    expect(objects.has("evidence/u1/expired.webp")).toBe(false);
    expect(evidence.find((e) => e.id === "e1")!.purged).toBe(true);
  });

  it("ไม่แตะรูปที่ยังไม่ครบกำหนด", async () => {
    const { db, bucket, objects } = setup();
    await runDailyJobs(db, [bucket], NOW);
    expect(objects.has("evidence/u1/active.webp")).toBe(true);
  });

  it("ลบไฟล์กำพร้าที่เก่ากว่า 24 ชม. แต่เก็บไฟล์ที่เพิ่งอัปโหลด (ผู้ใช้อาจกำลังกรอกฟอร์ม)", async () => {
    const { db, bucket, objects } = setup();
    const r = await runDailyJobs(db, [bucket], NOW);
    expect(r.orphanUploadsDeleted).toBe(1);
    expect(objects.has("evidence/u2/orphan-old.webp")).toBe(false);
    expect(objects.has("evidence/u2/orphan-new.webp")).toBe(true);
  });

  it("ลบ audit log ที่เกินระยะเก็บ", async () => {
    const { db, bucket } = setup();
    expect((await runDailyJobs(db, [bucket], NOW)).auditLogsDeleted).toBe(3);
  });

  it("รันซ้ำได้โดยไม่ลบซ้ำ (idempotent)", async () => {
    const { db, bucket } = setup();
    await runDailyJobs(db, [bucket], NOW);
    expect(await runDailyJobs(db, [bucket], NOW)).toEqual({ purgedEvidence: 0, orphanUploadsDeleted: 0, auditLogsDeleted: 3 });
  });
});
