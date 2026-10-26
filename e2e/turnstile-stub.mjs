// stub ตรวจ Turnstile สำหรับทดสอบบนเครื่องเท่านั้น (ตั้ง TURNSTILE_VERIFY_URL=http://127.0.0.1:8788/verify ใน .env.local)
// production ใช้ endpoint ของ Cloudflare เสมอ — ค่า TURNSTILE_VERIFY_URL ถูกละเลยเมื่อ NODE_ENV=production
import http from "node:http";
http
  .createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end('{"success":true}');
  })
  .listen(8788, "127.0.0.1");
