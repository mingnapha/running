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
    delete: async (keys) => keys.forEach((k) => objects.delete(k)),
    list: async () => ({ objects: [...objects].map(([key, uploaded]) => ({ key, uploaded })), truncated: false }),
  };
  return { db, bucket, objects, evidence };
}

describe("runDailyJobs", () => {
  it("ลบรูปที่ครบ 90 วัน และทำเครื่องหมายในฐานข้อมูล", async () => {
    const { db, bucket, objects, evidence } = setup();
    const r = await runDailyJobs(db, bucket, NOW);
    expect(r.purgedEvidence).toBe(1);
    expect(objects.has("evidence/u1/expired.webp")).toBe(false);
    expect(evidence.find((e) => e.id === "e1")!.purged).toBe(true);
  });

  it("ไม่แตะรูปที่ยังไม่ครบกำหนด", async () => {
    const { db, bucket, objects } = setup();
    await runDailyJobs(db, bucket, NOW);
    expect(objects.has("evidence/u1/active.webp")).toBe(true);
  });

  it("ลบไฟล์กำพร้าที่เก่ากว่า 24 ชม. แต่เก็บไฟล์ที่เพิ่งอัปโหลด (ผู้ใช้อาจกำลังกรอกฟอร์ม)", async () => {
    const { db, bucket, objects } = setup();
    const r = await runDailyJobs(db, bucket, NOW);
    expect(r.orphanUploadsDeleted).toBe(1);
    expect(objects.has("evidence/u2/orphan-old.webp")).toBe(false);
    expect(objects.has("evidence/u2/orphan-new.webp")).toBe(true);
  });

  it("ลบ audit log ที่เกินระยะเก็บ", async () => {
    const { db, bucket } = setup();
    expect((await runDailyJobs(db, bucket, NOW)).auditLogsDeleted).toBe(3);
  });

  it("รันซ้ำได้โดยไม่ลบซ้ำ (idempotent)", async () => {
    const { db, bucket } = setup();
    await runDailyJobs(db, bucket, NOW);
    expect(await runDailyJobs(db, bucket, NOW)).toEqual({ purgedEvidence: 0, orphanUploadsDeleted: 0, auditLogsDeleted: 3 });
  });
});
