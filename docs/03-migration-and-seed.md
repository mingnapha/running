# workingRun — ขั้นที่ 3: SQL migration และ seed data

> สถานะ: **รอผู้ใช้ตรวจ**

## การตัดสินใจเพิ่มเติม: โฮสต์บน Cloudflare (แทน Vercel)

| เรื่อง | บน Cloudflare |
|---|---|
| รัน Next.js | Cloudflare Workers ผ่าน `@opennextjs/cloudflare` (Free plan ใช้เชิงพาณิชย์ได้) |
| CDN cache ของ endpoint `version` / `leaderboard?v=` | Workers Cache API + header `Cache-Control: s-maxage` |
| รูปหลักฐาน | R2 binding ตรงใน Worker (ไม่ต้องใช้ S3 key) — อัปโหลดผ่าน route ที่ตรวจสิทธิ์ก่อน |
| Job ลบรูป 90 วัน / ลบ audit เกิน 2 ปี / ping กัน Supabase หลับ | **Cron Triggers** ของ Workers (ฟรี) เรียก `evidence_due_for_purge` → ลบใน R2 → `mark_evidence_purged` |
| Turnstile | อยู่ใน Cloudflare อยู่แล้ว ตรวจ token ใน route ล็อกอิน |
| ข้อจำกัดที่ต้องระวัง | Workers Free: CPU 10 ms/request — การ render หน้าส่วนใหญ่ผ่าน แต่ต้องย้ายงานหนัก (บีบอัดรูป) ไปทำฝั่ง client ซึ่งออกแบบไว้แล้ว ถ้าไม่พอค่อยขยับเป็น Workers Paid ($5/เดือน) |

## ไฟล์

| ไฟล์ | เนื้อหา |
|---|---|
| `supabase/migrations/20261021000001_schema.sql` | enum, 16 ตาราง, constraint, index |
| `supabase/migrations/20261021000002_functions.sql` | trigger กฎธุรกิจ, audit, คำนวณอันดับ, RPC ของแต่ละ role, job |
| `supabase/migrations/20261021000003_rls.sql` | RLS ทุกตาราง + grant ระดับคอลัมน์/ฟังก์ชัน |
| `supabase/seed.sql` | 10 คน, 3 แผนก, 2 ฤดูกาล (dev/staging เท่านั้น) |
| `supabase/tests/00_local_supabase_shim.sql` | จำลอง `auth.*` และ role ของ Supabase เพื่อทดสอบบน Postgres เปล่า |
| `supabase/tests/01_business_rules.sql` | 56 เทส: กฎห้ามส่ง, ติดธง, RLS, อนุมัติ/เพิกถอน, อันดับเท่ากัน, append-only, กติกาเวอร์ชัน, ปิดฤดูกาล, ปิดบัญชี, ล็อกบัญชี |
| `supabase/tests/run_local.sh` | สร้าง DB ใหม่ → migration → seed → tests |

## วิธีรัน

```bash
# บน Supabase (local ด้วย CLI หรือโปรเจกต์จริง)
supabase db reset            # รัน migrations + seed.sql

# บน Postgres เปล่า (CI)
PGHOST=localhost PGUSER=postgres ./supabase/tests/run_local.sh
```

ผลการรันล่าสุด (Postgres 16): migration ผ่าน, seed ผ่าน, **56/56 เทสผ่าน**

## จุดที่เปลี่ยนจากขั้นที่ 2 / ขั้นที่ 1

1. **แก้ไขรายการวิ่ง:** พนักงานแก้ค่าไม่ได้ — ทำได้แค่ "ยกเลิก" ตอนรอตรวจแล้วส่งใหม่ (DB บล็อกการแก้ระยะ/เวลา/วันที่ทุกกรณีด้วย `RUN_IMMUTABLE`) เพื่อให้หลักฐานกับตัวเลขที่ผู้ตรวจเห็นตรงกันเสมอ
2. **ปิดฤดูกาล:** ต้องผ่าน `close_season()` เท่านั้น และปิดได้เมื่อ **ตรวจครบทุกรายการแล้ว** — ไม่มีการบังคับปิด (ล็อกแถวฤดูกาลระหว่างปิด กันรายการใหม่แทรกเข้ามา)
5. **คำขอลบข้อมูล:** `close_user_account()` ปิดบัญชีและลบรูปทันที แต่ **เก็บ** ชื่อ รหัสพนักงาน คะแนน อันดับย้อนหลัง และ audit log ไว้ครบ (ระบบภายใน ลบทั้งระบบเมื่อจบโครงการ) — อันดับของคนอื่นไม่เปลี่ยน
3. **Real-time ping:** ส่ง 1 ping ต่อ 1 transaction (อนุมัติหลายรายการ = ping เดียว) แทนการ debounce เพราะการอนุมัติเกิดไม่บ่อย
4. **ไม่ใช้ `btree_gist`:** exclusion constraint บน `daterange` ใช้ GiST ในตัวได้เลย

## โครงสร้างสิทธิ์ (สรุป)

| การกระทำ | ทางเดียวที่ทำได้ | ใคร |
|---|---|---|
| บันทึกการวิ่ง + รูป | `submit_run()` | ผู้ใช้ที่อยู่ใน `season_participants` |
| ยกเลิกรายการตัวเอง | `cancel_run()` | เจ้าของ (เฉพาะ pending) |
| อนุมัติ/ปฏิเสธ/เพิกถอน | `review_run()`, `review_runs_bulk()` | approver, admin (ห้ามตรวจของตัวเอง) |
| ปรับคะแนนด้วยมือ / คำนวณย้อนหลัง | `adjust_points()`, `recalculate_season()` | admin |
| สร้างฤดูกาล / แก้กติกา / ผู้มีสิทธิ์ | ตารางตรง (RLS + grant ระดับคอลัมน์) | admin |
| สร้างบัญชีพนักงาน | Supabase Auth Admin API → `admin_provision_user()` | server (service_role) ในนามแอดมิน |
| คำขอลบข้อมูล (ปิดบัญชี + ลบรูป) | `close_user_account()` | admin |
| ลบรูปหมดอายุ, ลบ audit เก่า, ตรวจล็อกบัญชี | `evidence_due_for_purge()` ฯลฯ | Cron Trigger / server (service_role) |
| แก้หรือลบ `point_ledger`, `run_reviews`, `audit_logs` | **ไม่มีใครทำได้** (trigger บล็อกแม้ superuser) | — |

## รหัส error ที่ API ต้องแปลเป็น 2 ภาษา

`RUN_DATE_IN_FUTURE`, `RUN_DATE_TOO_OLD`, `DISTANCE_BELOW_MIN`, `NO_ACTIVE_SEASON_FOR_DATE`, `NOT_A_PARTICIPANT`,
`EVIDENCE_REQUIRED`, `INVALID_EVIDENCE_KEY`, `TOO_MANY_EVIDENCE_FILES`, `RUN_NOT_CANCELLABLE`, `RUN_IMMUTABLE`,
`INVALID_RUN_TRANSITION`, `RUN_NOT_FOUND`, `RUN_NOT_PENDING`, `RUN_NOT_APPROVED`, `CANNOT_REVIEW_OWN_RUN`,
`SEASON_NOT_ACTIVE`, `SEASON_CLOSED`, `SEASON_HAS_PENDING_RUNS`, `USE_CLOSE_SEASON`, `INVALID_SEASON_TRANSITION`,
`SEASON_DELETE_ONLY_DRAFT`, `BULK_LIMIT_EXCEEDED`, `BULK_REVOKE_NOT_ALLOWED`, `FORBIDDEN`, `NOT_AUTHENTICATED`,
`PRIVACY_NOTICE_OUTDATED`, `DELETION_ALREADY_REQUESTED`, `CANNOT_CLOSE_OWN_ACCOUNT`, `USER_NOT_FOUND`, `APPEND_ONLY`

ทั้งหมดใช้ SQLSTATE `WR001` และ `message` = รหัส, `detail` = JSON ค่าประกอบ (เช่น `{"max_days": 7}`)

## ข้อมูลตัวอย่างใน seed

**ฤดูกาล 1/2569** (1 ก.ค. – 30 ก.ย. 2569, ปิดแล้ว, กติกา v2 = 8 แต้ม/กม.)

| อันดับ | ชื่อ | กม. | แต้ม |
|---|---|---|---|
| 1 | สุดารัตน์ ก. | 26.1 | 208.8 |
| 2 | ธนพล ส. | 23.4 | 187.2 |
| 3 | ณัฐชา ร. | 21.0 | 168.0 |
| 4 | วิทยา พ. | 15.5 | 124.0 |
| 5–8 | อรรถพล จ., พิมพ์ชนก ท., กิตติพงษ์ ม., ปวีณา ช. | | |

**ฤดูกาล 2/2569** (1 ต.ค. – 31 ธ.ค. 2569, เปิดอยู่, 10 แต้ม/กม.)

| อันดับ | ชื่อ | กม. | แต้ม | หมายเหตุ |
|---|---|---|---|---|
| 1 | สุดารัตน์ ก. | 15.5 | 155 | มีรายการค้างตรวจ 8 กม. |
| 2 | ธนพล ส. | 14.2 | 142 | มี 1 รายการถูกเพิกถอน |
| 3 | กิตติพงษ์ ม. | 12.0 | 120 | มี 1 รายการถูกปฏิเสธ |
| 4 | อรรถพล จ. | 9.0 | 90 | ค้างตรวจ 15 กม. ใน 40 นาที → ธง pace เร็วผิดปกติ |
| 5 | ณัฐชา ร. | 8.0 | 80 | **เท่ากับอันดับ 6 แต่ถึงก่อน** |
| 6 | วิทยา พ. | 8.0 | 80 | |
| 7 | ประเสริฐ ว. (admin) | 6.0 | 60 | |
| 8 | พิมพ์ชนก ท. | 5.0 | 55 | +5 จากแอดมินปรับให้ |
| — | ปวีณา ช. | 0 | 0 | ค้างตรวจ 2 รายการ ซ้ำกัน → ธง duplicate |
| — | ศิริพร ล. (approver) | 0 | 0 | |

บัญชีทั้งหมด: `EMP001`–`EMP010` รหัสผ่าน `WorkingRun#2569` (EMP009 = ผู้ตรวจ, EMP010 = แอดมิน)
