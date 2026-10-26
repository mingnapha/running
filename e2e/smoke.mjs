// ทดสอบ end-to-end บนเครื่อง (ต้องมี: npx supabase start, npm run dev ที่ localhost:3000, stub Turnstile ที่ 127.0.0.1:8788)
// รัน: npm i --no-save playwright@1.56.1 && node e2e/smoke.mjs <โฟลเดอร์เก็บภาพ>
// ก่อนรันให้ `npx supabase db reset` และตั้ง EMP009/EMP010 ให้ผ่านด่านแรกเข้าแล้ว (ดู docs/06-mvp.md)
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = process.argv[2];
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`); };

// Turnstile ปลอมฝั่งเบราว์เซอร์ (sandbox นี้เข้า challenges.cloudflare.com ไม่ได้)
const FAKE_TURNSTILE = `window.turnstile={render(el,o){setTimeout(()=>o.callback('test-token'),50);return 'w';},remove(){}};`;
// PNG 64x64 สีเขียว (สร้างใน node)
import zlib from "node:zlib";
function png(w, h) {
  const crc = (buf) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const b of buf) x = t[(x ^ b) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; raw[i] = 47; raw[i + 1] = 191; raw[i + 2] = 155; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const browser = await chromium.launch();
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "th-TH", timezoneId: "Asia/Bangkok", ...opts });
  await ctx.route("https://challenges.cloudflare.com/**", (r) => r.fulfill({ contentType: "application/javascript", body: FAKE_TURNSTILE }));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  return page;
}
async function login(page, user, pass) {
  await page.goto(`${BASE}/login`);
  await page.fill("#username", user);
  await page.fill("#password", pass);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
}

// ---------------------------------------------------------------- API guards
{
  const r1 = await fetch(`${BASE}/api/v1/me`);
  check("API: ไม่ล็อกอิน → 401", r1.status === 401);
  const r2 = await fetch(`${BASE}/api/v1/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  check("API: POST ไม่มี header กัน CSRF → 403", r2.status === 403);
  const r3 = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "workingrun" }, body: JSON.stringify({ username: "EMP001", password: "wrong-password", turnstileToken: "t" }) });
  const b3 = await r3.json();
  check("API: รหัสผิด → 401 INVALID_CREDENTIALS", r3.status === 401 && b3.error.code === "INVALID_CREDENTIALS");
  const r4 = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "workingrun" }, body: JSON.stringify({ username: "NOPE99", password: "x", turnstileToken: "t" }) });
  check("API: ไม่มีผู้ใช้ → ข้อความเดียวกับรหัสผิด", (await r4.json()).error.code === "INVALID_CREDENTIALS");
}

// ---------------------------------------------------------------- runner: first login
const runner = await newPage();
await login(runner, "EMP001", "WorkingRun#2569");
await runner.waitForURL("**/change-password");
check("ล็อกอินครั้งแรก → บังคับเปลี่ยนรหัสผ่าน", true);
await runner.screenshot({ path: `${OUT}/01-change-password.png` });
await runner.fill("#current", "WorkingRun#2569");
await runner.fill("#new", "emp001short");
check("ฟอร์มเตือนรหัสผ่านที่มีรหัสพนักงาน", await runner.getByText("ห้ามมีรหัสพนักงาน").isVisible());
await runner.fill("#new", "VingTookWan2569");
await runner.fill("#confirm", "VingTookWan2569");
await runner.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" }).click();
await runner.waitForURL("**/consent");
check("เปลี่ยนรหัสแล้ว → หน้าประกาศความเป็นส่วนตัว", true);
await runner.getByRole("button", { name: "ยอมรับและเริ่มใช้งาน" }).click();
await runner.waitForURL(`${BASE}/`);
await runner.waitForSelector(".leader-banner");
const leaderName = await runner.locator(".leader-banner .name").textContent();
check("หน้าหลัก: ผู้นำคือ สุดารัตน์ ก. (ตาม seed)", leaderName?.includes("สุดารัตน์"), leaderName);
const rows = await runner.locator("ol.lb > li").count();
check("ตารางคะแนนมี 8 คน", rows === 8, String(rows));
const ranks = await runner.locator("ol.lb > li .lb-name strong").allTextContents();
check("อันดับเท่ากัน: ณัฐชา (5) ก่อน วิทยา (6)", ranks[4]?.includes("ณัฐชา") && ranks[5]?.includes("วิทยา"), ranks.slice(4, 6).join(","));
check("สนามแข่งแสดง 5 ลู่", (await runner.locator(".race-lane").count()) === 5);
check("วันที่แบบ พ.ศ.", (await runner.locator("text=1 ต.ค. 2569").count()) > 0);
await runner.screenshot({ path: `${OUT}/02-home-mobile.png` });

// ---------------------------------------------------------------- runner: log a run
await runner.goto(`${BASE}/runs/new`);
await runner.fill("#distance", "5.2");
await runner.getByLabel("นาที", { exact: true }).fill("31");
await runner.getByText("pace 5:58 /กม.").first().waitFor();
check("ฟอร์มแสดง pace และแต้มที่จะได้ทันที", await runner.getByText("+52 แต้ม").isVisible());
await runner.locator('input[type="file"]').setInputFiles({ name: "run.png", mimeType: "image/png", buffer: png(64, 64) });
await runner.waitForSelector(".photo-slot img[style*='opacity: 1']", { timeout: 20000 });
check("อัปโหลดรูป (บีบอัด + เก็บใน R2 จำลอง)", true);
await runner.screenshot({ path: `${OUT}/03-record-form.png`, fullPage: true });
await runner.getByRole("button", { name: "ส่งให้ตรวจสอบ" }).click();
await runner.getByText("ส่งแล้ว! รอผู้ตรวจอนุมัติ").waitFor();
check("ส่งรายการวิ่งสำเร็จ (สถานะรอตรวจ)", true);
await runner.goto(`${BASE}/runs`);
const firstStatus = await runner.locator(".list li").first().locator(".badge").first().textContent();
check("ประวัติ: รายการล่าสุด = รอตรวจสอบ", firstStatus === "รอตรวจสอบ", firstStatus);
await runner.screenshot({ path: `${OUT}/04-history.png`, fullPage: true });

// รายการผิดกฎ: วันที่ย้อนหลังเกิน 7 วัน (เรียก API ตรง — ฐานข้อมูลต้องปฏิเสธ)
{
  const res = await runner.request.post(`${BASE}/api/v1/runs`, { headers: { "x-requested-with": "workingrun" }, data: { runDate: "2026-10-10", distanceKm: 3, durationSeconds: 1200, evidenceKeys: ["evidence/x/y.webp"] } });
  const body = await res.json();
  check("API: evidence ของคนอื่น → INVALID_EVIDENCE_KEY", res.status() === 422 && body.error.code === "INVALID_EVIDENCE_KEY", body.error.code);
}

// ---------------------------------------------------------------- approver
const approver = await newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
await login(approver, "EMP009", "WorkingRun#2569");
await approver.waitForURL(`${BASE}/`);
await approver.goto(`${BASE}/review`);
await approver.waitForSelector(".list li");
await approver.screenshot({ path: `${OUT}/05-review-queue.png`, fullPage: true });
const card = approver.locator(".list li", { hasText: "ธนพล ส." });
check("คิวตรวจมีรายการใหม่ของ ธนพล", (await card.count()) === 1);
check("คิวตรวจแสดงธง pace เร็วผิดปกติ (seed)", (await approver.getByText("pace เร็วผิดปกติ").count()) > 0);
check("รูปหลักฐานโหลดได้ผ่าน API ที่ตรวจสิทธิ์", await card.locator("img.thumb").evaluate((img) => img.complete && img.naturalWidth > 0));
await card.getByRole("button", { name: "อนุมัติ" }).click();
await card.waitFor({ state: "detached" });
check("อนุมัติแล้วรายการหายจากคิว", true);
// ปฏิเสธต้องมีเหตุผล
const pav = approver.locator(".list li", { hasText: "ปวีณา ช." });
const pavBefore = await pav.count();
const dup = pav.first();
await dup.getByRole("button", { name: "ปฏิเสธ" }).click();
check("ปุ่มยืนยันปฏิเสธปิดอยู่จนกว่าจะใส่เหตุผล", await dup.getByRole("button", { name: "ปฏิเสธ" }).isDisabled());
await dup.locator("textarea").fill("รายการซ้ำ");
await dup.getByRole("button", { name: "ปฏิเสธ" }).click();
await approver.waitForFunction((n) => [...document.querySelectorAll(".list li")].filter((li) => li.textContent.includes("ปวีณา ช.")).length === n - 1, pavBefore);
check("ปฏิเสธพร้อมเหตุผลสำเร็จ", true);

// ---------------------------------------------------------------- live update on runner's home
await runner.goto(`${BASE}/`);
await runner.waitForFunction(() => document.querySelector(".leader-banner .name")?.textContent?.includes("ธนพล"), null, { timeout: 30000 });
check("หลังอนุมัติ ธนพล ขึ้นเป็นผู้นำ (142 + 52 = 194)", (await runner.locator(".leader-banner .pts").textContent())?.startsWith("194"));
await runner.screenshot({ path: `${OUT}/06-home-after-approve.png`, fullPage: true });

// อัปเดตเองโดยไม่โหลดหน้าใหม่: approver อนุมัติรายการของ สุดารัตน์ (8 กม.) → แซงกลับ
const live = await newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
await login(live, "EMP010", "WorkingRun#2569");
await live.waitForURL(`${BASE}/`);
await live.waitForSelector(".leader-banner");
const before = await live.locator(".leader-banner .name").textContent();
const sud = approver.locator(".list li", { hasText: "สุดารัตน์ ก." }).first();
await sud.getByRole("button", { name: "อนุมัติ" }).click();
await sud.waitFor({ state: "detached" });
await live.waitForFunction(() => document.querySelector(".leader-banner .name")?.textContent?.includes("สุดารัตน์"), null, { timeout: 25000 });
const upBadge = await live.locator("ol.lb > li").first().locator(".badge-up").textContent().catch(() => null);
check("อัปเดตอัตโนมัติภายใน 25 วินาทีโดยไม่โหลดหน้าใหม่", before?.includes("ธนพล"), `${before} → สุดารัตน์`);
check("แสดง ▲ ขึ้น 1 อันดับ", upBadge === "▲ ขึ้น 1 อันดับ", upBadge ?? "");
const downBadge = await live.locator("ol.lb > li").nth(1).locator(".badge-down");
check("อันดับที่ตกเป็นสีเทาพร้อม ▼ (ไม่ใช่สีแดง)", (await downBadge.textContent()) === "▼ ลง 1 อันดับ" && (await downBadge.evaluate((el) => getComputedStyle(el).color)) === "rgb(125, 138, 151)");
await live.waitForTimeout(1500); // รอแอนิเมชันจบ
await live.screenshot({ path: `${OUT}/07-home-desktop.png`, fullPage: true });

// ---------------------------------------------------------------- admin
await live.goto(`${BASE}/admin/users`);
await live.fill("#employeeCode", "EMP011");
await live.fill("#displayName", "ทดสอบ ใหม่");
await live.getByRole("button", { name: "สร้างบัญชี" }).click();
await live.locator(".secret").waitFor();
const temp = await live.locator(".secret").textContent();
check("แอดมินสร้างบัญชี → ได้รหัสผ่านชั่วคราว 12 ตัว", temp?.length === 12, temp ?? "");
await live.screenshot({ path: `${OUT}/08-admin-users.png`, fullPage: true });
const newbie = await newPage();
await login(newbie, "EMP011", temp);
await newbie.waitForURL("**/change-password");
check("บัญชีใหม่ล็อกอินด้วยรหัสชั่วคราวได้ และถูกบังคับเปลี่ยน", true);
await live.goto(`${BASE}/admin`);
await live.locator("a", { hasText: "ฤดูกาล 2/2569" }).click();
await live.waitForSelector("#pointsPerKm");
check("หน้ากติกาแสดงค่าปัจจุบัน 10 แต้ม/กม.", (await live.inputValue("#pointsPerKm")) === "10");
await live.getByRole("button", { name: "ปิดฤดูกาล" }).click({ trial: true });
await live.screenshot({ path: `${OUT}/09-admin-season.png`, fullPage: true });
live.once("dialog", (d) => d.accept());
await live.getByRole("button", { name: "ปิดฤดูกาล" }).click();
await live.getByText(/ยังมีรายการรอตรวจ \d+ รายการ/).waitFor();
check("ปิดฤดูกาลไม่ได้เมื่อยังมีรายการรอตรวจ", true);

// ---------------------------------------------------------------- dark mode, English, reduced motion
const dark = await newPage({ colorScheme: "dark", reducedMotion: "reduce" });
await login(dark, "EMP010", "WorkingRun#2569");
await dark.waitForURL(`${BASE}/`);
await dark.waitForSelector(".leader-banner");
check("dark mode: พื้นหลังเปลี่ยน", (await dark.evaluate(() => getComputedStyle(document.body).backgroundColor)) === "rgb(11, 22, 34)");
check("reduced motion: ปิด transition ของสนามแข่ง", (await dark.locator(".race-lane").first().evaluate((el) => getComputedStyle(el).transitionDuration)) === "1e-05s");
await dark.screenshot({ path: `${OUT}/10-home-dark.png`, fullPage: true });
await dark.getByRole("button", { name: "English" }).click();
await dark.getByRole("heading", { name: "Full ranking" }).waitFor();
check("สลับเป็นภาษาอังกฤษ", (await dark.locator("text=1 Oct 2026").count()) > 0);
await dark.screenshot({ path: `${OUT}/11-home-english-dark.png` });

await browser.close();
const failed = results.filter((r) => !r.ok);
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
