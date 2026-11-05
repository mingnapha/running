# ทดลองขึ้นเว็บบน Cloudflare (สาธิตก่อนคุยลูกค้า)

> เป้าหมาย: ได้ลิงก์เว็บจริง เช่น `https://workingrun.<ชื่อของคุณ>.workers.dev` ที่มีข้อมูลตัวอย่าง 10 คน
> ไว้ลองใช้และโชว์ลูกค้า — **ไม่ต้องพิมพ์คำสั่งในเครื่อง** ทำผ่านหน้าเว็บทั้งหมด ใช้เวลาประมาณ 30–45 นาที
> ทุกบริการใช้แพ็กเกจฟรี

ทำ 3 ส่วนตามลำดับ: **A. Supabase (ฐานข้อมูล)** → **B. Cloudflare (ที่เก็บรูป + กันบอท)** → **C. Cloudflare (ขึ้นเว็บจาก GitHub)**

ระหว่างทางให้จดค่า 6 ค่านี้ไว้ในโน้ต (ห้ามแชร์ต่อ):

| # | ชื่อ | ได้จาก |
|---|---|---|
| 1 | `SUPABASE_URL` | ขั้น A4 |
| 2 | `SUPABASE_ANON_KEY` | ขั้น A4 |
| 3 | `SUPABASE_SERVICE_ROLE_KEY` | ขั้น A4 (**ความลับสูงสุด**) |
| 4 | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | ขั้น B3 |
| 5 | `TURNSTILE_SECRET_KEY` | ขั้น B3 |
| 6 | `LOGIN_HASH_SALT` | พิมพ์ตัวอักษรมั่วๆ ยาว 32 ตัวขึ้นไป เช่น `kq83hf02nx71mzpq4ld9vbw6ty5rce2a` |

---

## A. Supabase — ฐานข้อมูล

1. สมัคร/ล็อกอินที่ https://supabase.com → **New project**
   - Name: `workingrun-demo` · Region: **Southeast Asia (Singapore)** · ตั้ง Database password แล้วจดไว้
2. รอสร้างเสร็จ (1–2 นาที)
3. เมนูซ้าย **SQL Editor** → New query →
   เปิดไฟล์ [`supabase/demo/all-in-one-demo.sql`](../supabase/demo/all-in-one-demo.sql) บน GitHub → กดปุ่ม **Copy raw file** → วางในช่อง → **Run**
   - ควรขึ้น "Success" — ตอนนี้มีตาราง + ผู้ใช้ตัวอย่าง `EMP001`–`EMP010` รหัสผ่าน `WorkingRun#2569` แล้ว
4. เมนูซ้าย **Project Settings → API Keys** → แท็บ **Legacy API Keys**
   - จด `anon` `public` → ค่าที่ 2 · กด Reveal ที่ `service_role` → ค่าที่ 3
   - **Project Settings → Data API** (หรือหน้า Connect) → จด Project URL (`https://xxxx.supabase.co`) → ค่าที่ 1
5. เมนู **Authentication → Sign In / Providers**
   - ปิด **Allow new users to sign up** (กันคนนอกสมัครเอง)
   - **Email ต้องเปิดอยู่** (ถ้าปิด จะล็อกอินไม่ได้เลย)
   - ปิด **Confirm email**

## B. Cloudflare — ที่เก็บรูปและกันบอท

1. สมัคร/ล็อกอินที่ https://dash.cloudflare.com
2. **R2 Object Storage** (เมนูซ้าย) → เปิดใช้งาน
   - Cloudflare จะขอให้ผูกบัตรเครดิต/เดบิต แม้ใช้ฟรี (ฟรี 10 GB — งานนี้ใช้ไม่ถึง จึงไม่ถูกเก็บเงิน)
   - **Create bucket** → ชื่อ `workingrun-evidence` (ต้องตรงตัวอักษร) → Create
3. **Turnstile** (เมนูซ้าย) → **Add widget**
   - Widget name: `workingrun` · Hostname: `workers.dev` · Widget mode: **Managed** → Create
   - จด **Site Key** → ค่าที่ 4 · **Secret Key** → ค่าที่ 5

## C. Cloudflare — ขึ้นเว็บจาก GitHub

1. **Workers & Pages** → **Create** → แท็บ Workers → **Import a repository** → เชื่อม GitHub → เลือก repo `running`
2. ตั้งค่า:

   | ช่อง | ใส่ |
   |---|---|
   | Project name | `workingrun` (**ต้องตรง** กับชื่อใน `wrangler.jsonc`) |
   | Build command | `npx opennextjs-cloudflare build` |
   | Deploy command | `npx wrangler deploy` |
   | Branch | `claude/trusting-rubin-v4pj4n` (branch ที่มีโค้ดตอนนี้) |

3. **Advanced settings → Variables** — เพิ่มทั้ง 6 ค่าจากโน้ต (ชื่อต้องตรงตัวพิมพ์ใหญ่/เล็ก) แบบ **Secret/Encrypt**
4. **Deploy** → รอ 3–5 นาที (ดูความคืบหน้าในแท็บ Deployments / Build logs)
5. ถ้าตัวแปรยังไม่ถูกส่งไปตอนรันเว็บ: เข้า Worker `workingrun` → **Settings → Variables and Secrets** → เพิ่ม 6 ค่าอีกครั้งที่นี่ → **Deployments → Retry/Redeploy**
6. ได้ลิงก์ `https://workingrun.<ชื่อ>.workers.dev` → เปิดดู

## ทดลองใช้

| บัญชี | บทบาท | ใช้ลองอะไร |
|---|---|---|
| `EMP001` | พนักงาน | ล็อกอินครั้งแรก → เปลี่ยนรหัส → บันทึกการวิ่งจากมือถือ |
| `EMP009` | ผู้ตรวจ | อนุมัติ/ปฏิเสธ (มีรายการรอตรวจอยู่แล้ว 5 รายการ) |
| `EMP010` | แอดมิน | ฤดูกาล กติกา เพิ่มพนักงาน |

รหัสผ่านเริ่มต้นทุกบัญชี `WorkingRun#2569` — ทุกบัญชีจะถูกบังคับเปลี่ยนรหัสครั้งแรก

**ทริกโชว์ลูกค้า:** เปิดหน้าตารางคะแนนบนจอหนึ่ง แล้วใช้มือถืออีกเครื่องล็อกอิน EMP009 อนุมัติรายการ — ภายใน ~10 วินาทีตารางบนจอแรกจะขยับเอง (นักวิ่งสลับลู่ ▲/▼)

## ถ้ามีปัญหา

| อาการ | สาเหตุที่พบบ่อย |
|---|---|
| Build ล้ม ขึ้น `bucket ... not found` | ชื่อ bucket ไม่ใช่ `workingrun-evidence` |
| Build ล้ม ชื่อ Worker ไม่ตรง | Project name ไม่ใช่ `workingrun` |
| เปิดเว็บขึ้นหน้า error 500 | ตัวแปรไม่ครบ 6 ตัว หรือพิมพ์ชื่อผิด (ดูข้อ C5) |
| ล็อกอินแล้วขึ้น "ยืนยันว่าไม่ใช่บอทไม่สำเร็จ" | Turnstile Hostname ไม่ตรงกับโดเมนเว็บ |
| ล็อกอินแล้วขึ้น "รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง" ทั้งที่ถูก | ปิด Email provider ไว้ (ดูข้อ A5) หรือยังไม่ได้รัน SQL ข้อ A3 |
| อัปโหลดรูปไม่ได้ | ยังไม่ได้สร้าง bucket R2 |

ส่งข้อความ error / ภาพหน้าจอ Build logs มาได้ ผมช่วยดูให้

## เมื่อเลิกทดลอง

ข้อมูลตัวอย่างและรหัสผ่านที่รู้กันใช้สำหรับสาธิตเท่านั้น — ตอนใช้งานจริงให้สร้างโปรเจกต์ Supabase ใหม่ และรันเฉพาะ migrations (ไม่รันข้อมูลตัวอย่าง)

## ปรับเพดานการอัปโหลดรูป (ไม่ต้องแก้โค้ด)

ค่าทั้งหมดเก็บในตาราง `system_settings` — แก้ได้ใน Supabase → SQL Editor แล้วมีผลทันที

| ค่า | เริ่มต้น | ความหมาย |
|---|---|---|
| `upload_limit_per_user_hour` | 20 | รูปต่อคนต่อชั่วโมง |
| `upload_limit_per_user_day` | 60 | รูปต่อคนต่อวัน |
| `upload_limit_global_day` | 1000 | รูปรวมทั้งระบบต่อวัน |
| `storage_limit_bytes` | 7516192768 (7 GB) | พื้นที่รูปรวม (R2 ฟรี 10 GB) |

```sql
-- ดูค่าปัจจุบัน
select upload_limit_per_user_hour, upload_limit_per_user_day, upload_limit_global_day,
       pg_size_pretty(storage_limit_bytes) as storage_limit from system_settings;

-- ตัวอย่าง: เมื่อเปิดใช้จริง 1,000 คน และยอมจ่ายค่า R2 ส่วนที่เกิน
update system_settings
set upload_limit_global_day = 5000,
    storage_limit_bytes = 30::bigint * 1024 * 1024 * 1024   -- 30 GB (ส่วนเกิน 20 GB ≈ $0.30/เดือน)
where id = 1;
```

> เพิ่ม `storage_limit_bytes` เกิน 7 GB เมื่อไหร่ = ยอมให้ R2 คิดเงินส่วนที่เกิน 10 GB ($0.015 ต่อ GB ต่อเดือน)
