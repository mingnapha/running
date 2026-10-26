import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * ส่วนที่ใช้จาก Cloudflare (R2 + Cache API) — ประกาศชนิดเฉพาะเมธอดที่ใช้
 * เพื่อไม่ต้องดึง @cloudflare/workers-types ทั้งชุดมาชนกับชนิดของ DOM
 */
export interface R2ObjectLike {
  key: string;
  size: number;
  uploaded: Date;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}
export interface R2ObjectBodyLike extends R2ObjectLike {
  body: ReadableStream;
}
export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | ReadableStream,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ): Promise<R2ObjectLike | null>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
  head(key: string): Promise<R2ObjectLike | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    objects: R2ObjectLike[];
    truncated: boolean;
    cursor?: string;
  }>;
}

interface CloudflareBindings {
  EVIDENCE_BUCKET: R2BucketLike;
}

export function evidenceBucket(): R2BucketLike {
  const { env } = getCloudflareContext();
  const bucket = (env as unknown as Partial<CloudflareBindings>).EVIDENCE_BUCKET;
  if (!bucket) throw new Error("R2 binding EVIDENCE_BUCKET is not configured");
  return bucket;
}

interface EdgeCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

function edgeCache(): EdgeCache | null {
  const c = (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches;
  return c?.default ?? null;
}

/**
 * เก็บผลลัพธ์ JSON ใน Workers Cache API (ต่อ data center) — เรียกหลังตรวจสิทธิ์แล้วเท่านั้น
 * ตอนพัฒนาบนเครื่อง (ไม่มี caches.default) จะเรียก loader ทุกครั้ง
 */
export async function cachedJson<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  const cache = edgeCache();
  const url = `https://cache.workingrun.internal/${key}`;
  if (cache) {
    const hit = await cache.match(url);
    if (hit) return (await hit.json()) as T;
  }
  const value = await loader();
  if (cache) {
    const res = new Response(JSON.stringify(value), {
      headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttlSeconds}` },
    });
    await cache.put(url, res).catch((err) => console.warn("edge cache put failed", err));
  }
  return value;
}
