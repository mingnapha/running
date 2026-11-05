import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { R2BucketLike } from "./cloudflare";
import { serviceClient } from "./supabase";

/**
 * ที่เก็บรูปหลักฐาน — เลือกอัตโนมัติ:
 *  - มี binding EVIDENCE_BUCKET (Cloudflare R2) → ใช้ R2 (ฟรี 10 GB แต่ต้องผูกบัตร)
 *  - ไม่มี → ใช้ Supabase Storage bucket "evidence" (ฟรี 1 GB ไม่ต้องผูกบัตร — พอสำหรับทดลอง/กลุ่มนำร่อง)
 * ทั้งสองแบบเป็นส่วนตัว: เปิดรูปได้ผ่าน API ที่ตรวจสิทธิ์เท่านั้น
 */
export type StorageProvider = "r2" | "supabase";
export const SUPABASE_EVIDENCE_BUCKET = "evidence";

export interface StoredObjectInfo {
  size: number;
  contentType: string | undefined;
  meta: Record<string, string>;
}

export interface EvidenceStore {
  provider: StorageProvider;
  put(key: string, bytes: ArrayBuffer, contentType: string, meta: Record<string, string>): Promise<void>;
  head(key: string): Promise<StoredObjectInfo | null>;
  get(key: string): Promise<ReadableStream | null>;
  delete(keys: string[]): Promise<void>;
  /** รายการไฟล์สำหรับลบไฟล์กำพร้า — Supabase Storage ไม่รองรับการไล่ทั้ง bucket จึงคืนว่าง */
  list(opts: { prefix: string; cursor?: string; limit: number }): Promise<{
    objects: { key: string; uploaded: Date }[];
    truncated: boolean;
    cursor?: string;
  }>;
}

export function r2Store(bucket: R2BucketLike): EvidenceStore {
  return {
    provider: "r2",
    async put(key, bytes, contentType, meta) {
      await bucket.put(key, bytes, { httpMetadata: { contentType }, customMetadata: meta });
    },
    async head(key) {
      const h = await bucket.head(key);
      return h ? { size: h.size, contentType: h.httpMetadata?.contentType, meta: h.customMetadata ?? {} } : null;
    },
    async get(key) {
      return (await bucket.get(key))?.body ?? null;
    },
    async delete(keys) {
      if (keys.length) await bucket.delete(keys);
    },
    list: (opts) => bucket.list(opts),
  };
}

export function supabaseStore(client: SupabaseClient): EvidenceStore {
  const files = () => client.storage.from(SUPABASE_EVIDENCE_BUCKET);
  return {
    provider: "supabase",
    async put(key, bytes, contentType, meta) {
      const { error } = await files().upload(key, bytes, { contentType, upsert: false, metadata: meta });
      if (error) throw new Error(`storage upload failed: ${error.message}`);
    },
    async head(key) {
      const { data, error } = await files().info(key);
      if (error || !data) return null;
      const meta = Object.fromEntries(
        Object.entries((data.metadata ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === "string"),
      ) as Record<string, string>;
      return { size: data.size ?? 0, contentType: data.contentType, meta };
    },
    async get(key) {
      const { data, error } = await files().download(key);
      return error || !data ? null : data.stream();
    },
    async delete(keys) {
      for (let i = 0; i < keys.length; i += 100) {
        const { error } = await files().remove(keys.slice(i, i + 100));
        if (error) throw new Error(`storage remove failed: ${error.message}`);
      }
    },
    async list() {
      return { objects: [], truncated: false };
    },
  };
}

function r2Binding(): R2BucketLike | null {
  try {
    const env = getCloudflareContext().env as unknown as { EVIDENCE_BUCKET?: R2BucketLike };
    return env.EVIDENCE_BUCKET ?? null;
  } catch {
    return null;
  }
}

export function evidenceStore(): EvidenceStore {
  const bucket = r2Binding();
  return bucket ? r2Store(bucket) : supabaseStore(serviceClient());
}
