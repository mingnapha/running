/**
 * Worker หลักบน Cloudflare: ส่งคำขอเว็บให้ Next.js (OpenNext) และรันงานรายวันจาก Cron Trigger
 * ต้องรัน `npm run cf:build` ก่อน (สร้าง .open-next/worker.js)
 */
// @ts-expect-error -- ไฟล์นี้ถูกสร้างตอน build
import { default as handler } from "./.open-next/worker.js";
import { scheduled } from "./src/cron/worker-cron";

type Ctx = { waitUntil(p: Promise<unknown>): void };

const worker = {
  fetch: handler.fetch,
  async scheduled(_controller: unknown, env: Parameters<typeof scheduled>[0], ctx: Ctx) {
    ctx.waitUntil(scheduled(env));
  },
};

export default worker;
