# workingRun

กิจกรรมวิ่งสะสมแต้มขององค์กร — พนักงานบันทึกการวิ่งจากมือถือ ผู้ตรวจอนุมัติ และทุกคนแข่งกันบนตารางคะแนนที่อัปเดตเอง

**Stack:** Next.js 16 (App Router) · Supabase (Postgres + Auth) · Cloudflare Workers (OpenNext) + R2 + Turnstile

## เอกสาร

| ขั้น | เอกสาร |
|---|---|
| 1 | [คำถามและสมมติฐาน](docs/01-questions-and-assumptions.md) |
| 2 | [ER diagram และการออกแบบฐานข้อมูล](docs/02-er-diagram.md) |
| 3 | [SQL migration และ seed](docs/03-migration-and-seed.md) |
| 4 | [API spec](docs/04-api-spec.md) · [OpenAPI](docs/api/openapi.yaml) |
| 5 | [แผนพัฒนาแบ่งเฟส](docs/05-development-plan.md) |
| 6 | [MVP: สิ่งที่ทำแล้วและวิธีใช้งาน](docs/06-mvp.md) |

## โครงสร้าง

```
src/
  lib/domain/      ตรรกะหลัก (คะแนน อันดับ กฎห้ามส่ง/ติดธง วันที่ไทย สนามแข่ง) — ไม่ขึ้นกับเฟรมเวิร์ก มี unit test
  lib/server/      ฝั่ง server: session, Supabase client, services, error
  lib/client/      ฝั่งหน้าเว็บ: เรียก API, บีบอัดรูป, hooks แอนิเมชัน
  app/api/v1/      REST API ตาม docs/api/openapi.yaml
  app/(app)/       หน้าที่ต้องล็อกอิน: ตารางคะแนน, บันทึก, ประวัติ, ตรวจสอบ, แอดมิน
  app/(auth)/      ล็อกอิน, เปลี่ยนรหัสผ่าน, ประกาศความเป็นส่วนตัว
  components/      สนามแข่ง ตารางคะแนน สถิติ เมนู
  cron/            งานรายวัน (ลบรูปครบ 90 วัน ฯลฯ)
messages/          ข้อความภาษาไทย/อังกฤษ
supabase/          migrations, seed, DB tests, config
worker.ts          Worker หลัก (เว็บ + Cron Trigger)
```

## พัฒนาบนเครื่อง

ต้องมี Node.js 22 และ Docker

```bash
npm ci
npx supabase start                 # Postgres + Auth + REST บนเครื่อง (รัน migrations + seed ให้เอง)
cp .dev.vars.example .dev.vars     # ใส่ anon/service key จาก `npx supabase status`
cp .dev.vars .env.local            # next dev อ่านจาก .env.local
npm run dev                        # http://localhost:3000 — ล็อกอิน EMP001 / WorkingRun#2569
```

บัญชีตัวอย่าง (seed): `EMP001`–`EMP010` รหัสผ่าน `WorkingRun#2569` · EMP009 = ผู้ตรวจ · EMP010 = แอดมิน

## ทดสอบ

```bash
npm test             # unit test (Vitest)
npm run lint
npm run typecheck
npm run test:db      # migrations + seed + DB tests บน Postgres เปล่า (ตั้ง PGHOST/PGUSER)
```

## ติดตั้งบน Cloudflare (ครั้งแรก)

1. **Supabase:** สร้างโปรเจกต์ (region Singapore) →
   - Authentication → Sign In / Providers → ปิด **Allow new users to sign up**
   - Authentication → Rate Limits → เพิ่ม **sign-ins** (คำขอล็อกอินทั้งหมดมาจาก IP ของ Cloudflare)
   - รัน migrations: `npx supabase link --project-ref <ref>` แล้ว `npx supabase db push`
   - **ห้ามรัน seed.sql บน production**
2. **Cloudflare:**
   - `npx wrangler r2 bucket create workingrun-evidence`
   - Turnstile → เพิ่ม widget ของโดเมน → ได้ site key / secret key
   - ตั้งค่าลับ: `npx wrangler secret put SUPABASE_URL` (และ `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `LOGIN_HASH_SALT`)
   - Security → WAF → Rate limiting rule: `/api/v1/auth/login` 10 ครั้ง/นาที/IP
3. `npm run cf:deploy`
4. สร้างแอดมินคนแรก: ใน Supabase SQL editor สร้างผู้ใช้ผ่าน Authentication → Add user (อีเมล `<รหัสพนักงาน>@users.workingrun.internal`) แล้วรัน
   ```sql
   insert into profiles (auth_user_id, employee_code, display_name) values ('<auth user id>', 'EMP0001', 'ชื่อแอดมิน') returning id;
   insert into user_roles (user_id, role) values ('<profile id>', 'admin'), ('<profile id>', 'runner');
   ```
