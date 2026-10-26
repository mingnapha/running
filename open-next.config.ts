import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// หน้าเว็บทั้งหมดเป็น dynamic (ต้องล็อกอิน) จึงไม่ต้องใช้ incremental cache
export default defineCloudflareConfig({});
