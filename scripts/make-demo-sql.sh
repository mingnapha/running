#!/usr/bin/env bash
# รวม migrations + seed เป็นไฟล์เดียว สำหรับวางใน Supabase SQL Editor ของโปรเจกต์ "ทดลอง/สาธิต"
# (ห้ามใช้กับโปรเจกต์จริงที่มีพนักงาน — seed มีบัญชีตัวอย่างและรหัสผ่านที่รู้กัน)
set -euo pipefail
cd "$(dirname "$0")/.."
out=supabase/demo/all-in-one-demo.sql
{
  echo "-- ไฟล์นี้สร้างจาก scripts/make-demo-sql.sh — ห้ามแก้ตรงนี้ ให้แก้ที่ supabase/migrations และ supabase/seed.sql"
  echo "-- ใช้กับโปรเจกต์สาธิตเท่านั้น: สร้างตาราง + ข้อมูลตัวอย่าง 10 คน 2 ฤดูกาล"
  for f in supabase/migrations/*.sql supabase/seed.sql; do
    echo; echo "-- ============================== $f"; cat "$f"
  done
} > "$out"
echo "wrote $out"
