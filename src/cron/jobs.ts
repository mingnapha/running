/**
 * งานรายวัน (Cloudflare Cron Trigger) — เขียนแบบรับ dependency เข้ามา เพื่อทดสอบได้โดยไม่ต้องมี Cloudflare/Supabase
 *  1. ลบรูปหลักฐานที่ครบกำหนด (90 วัน หรือเมื่อปิดบัญชี)
 *  2. ลบไฟล์ที่อัปโหลดแต่ไม่ถูกผูกกับรายการวิ่งภายใน 24 ชม.
 *  3. ลบ audit log ที่เกินระยะเก็บ + ประวัติล็อกอินเกิน 30 วัน
 * การเรียกฐานข้อมูลทุกวันยังช่วยกันไม่ให้ Supabase Free หยุดโปรเจกต์ด้วย
 */
export interface CronDb {
  dueEvidence(limit: number): Promise<{ id: string; object_key: string; storage_provider: string }[]>;
  markPurged(ids: string[]): Promise<number>;
  existingKeys(keys: string[]): Promise<Set<string>>;
  purgeAuditLogs(): Promise<number>;
}

export interface CronBucket {
  /** ตรงกับ evidence_files.storage_provider */
  provider: string;
  delete(keys: string[]): Promise<void>;
  list(opts: { prefix: string; cursor?: string; limit: number }): Promise<{
    objects: { key: string; uploaded: Date }[];
    truncated: boolean;
    cursor?: string;
  }>;
}

export interface CronResult {
  purgedEvidence: number;
  orphanUploadsDeleted: number;
  auditLogsDeleted: number;
}

const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;
const BATCH = 500;

export async function runDailyJobs(db: CronDb, buckets: CronBucket[], now: Date = new Date()): Promise<CronResult> {
  const byProvider = new Map(buckets.map((b) => [b.provider, b]));

  // 1) รูปที่ครบกำหนดลบ — ลบไฟล์ก่อน แล้วค่อยทำเครื่องหมายในฐานข้อมูล (ถ้าล้มกลางทาง รอบหน้าจะลองใหม่)
  //    รูปในที่เก็บที่ไม่ได้เชื่อมแล้ว (เช่น ปิด R2) จะค้างไว้รอบหน้า ไม่ทำเครื่องหมายว่าลบแล้ว
  let purgedEvidence = 0;
  for (let round = 0; round < 20; round++) {
    const due = (await db.dueEvidence(BATCH)).filter((e) => byProvider.has(e.storage_provider));
    if (due.length === 0) break;
    for (const [provider, bucket] of byProvider) {
      const mine = due.filter((e) => e.storage_provider === provider);
      if (mine.length === 0) continue;
      await bucket.delete(mine.map((e) => e.object_key));
      purgedEvidence += await db.markPurged(mine.map((e) => e.id));
    }
    if (due.length < BATCH) break;
  }

  // 2) ไฟล์กำพร้า (อัปโหลดแล้วไม่ได้ส่งรายการวิ่ง)
  let orphanUploadsDeleted = 0;
  for (const bucket of buckets) {
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await bucket.list({ prefix: "evidence/", cursor, limit: 1000 });
      const old = res.objects.filter((o) => now.getTime() - o.uploaded.getTime() > ORPHAN_AGE_MS).map((o) => o.key);
      if (old.length) {
        const known = await db.existingKeys(old);
        const orphans = old.filter((k) => !known.has(k));
        if (orphans.length) {
          await bucket.delete(orphans);
          orphanUploadsDeleted += orphans.length;
        }
      }
      if (!res.truncated) break;
      cursor = res.cursor;
    }
  }

  // 3) ระยะเก็บ audit log
  const auditLogsDeleted = await db.purgeAuditLogs();

  return { purgedEvidence, orphanUploadsDeleted, auditLogsDeleted };
}
