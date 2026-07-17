# เงินทอง — ระบบจดรายรับรายจ่าย

แอปจดรายรับ-รายจ่ายส่วนตัว รองรับ:

- **รายรับ-รายจ่าย** — บันทึกธุรกรรมรายวัน แยกตามหมวดหมู่และช่องทางการชำระ
- **รายจ่ายประจำเดือน** — ตั้งค่ารายจ่ายที่ต้องจ่ายซ้ำทุกเดือน (ค่าเน็ต ค่าเช่า ฯลฯ) ระบบจะขึ้นรายการ "รอชำระ" ให้อัตโนมัติเมื่อถึงกำหนด แล้วผู้ใช้กดยืนยันจ่ายเพื่อบันทึกเป็นธุรกรรมจริง
- **บัตรเครดิต** — บันทึกบัตรเครดิตหลายใบ ผูกกับธุรกรรม/รายจ่ายประจำ ดูยอดใช้จ่ายรอบบิลปัจจุบัน
- **ยืมเงิน / ลูกหนี้** — บันทึกเงินที่ให้คนอื่นยืม รองรับคืนแบบเงินสดก้อนเดียว ผ่อนรายเดือน หรือผ่อนสินค้า พร้อมติดตามยอดคงเหลือ
- **งบประมาณ** — ตั้งวงเงินต่อหมวดหมู่ต่อเดือน พร้อมแถบเตือนเมื่อใกล้/เกินงบ
- **แนวโน้มและกราฟ** — กราฟรายจ่ายตามหมวดหมู่ และแนวโน้มรายรับ-รายจ่ายย้อนหลัง 6 เดือนในหน้าภาพรวม
- **ส่งออก CSV** — ส่งออกรายการรายรับ-รายจ่าย (ตามตัวกรองปัจจุบัน) เป็นไฟล์ CSV
- **ค้นหา/กรอง** — ค้นหาด้วยคำ หรือกรองตามช่วงวันที่ในหน้ารายรับ-รายจ่าย
- **แจ้งเตือนก่อนถึงกำหนดจ่าย** — Web Push แจ้งเตือนทั้งรายจ่ายประจำและงวดผ่อนของลูกหนี้ที่ใกล้ถึงกำหนด (ทำงานผ่าน service worker + APScheduler รันทุกวัน)
- **ล็อกด้วย PIN** — ล็อกหน้าจอแอปด้วยรหัส PIN ต่ออุปกรณ์ (privacy screen ฝั่ง client ไม่ได้เข้ารหัสข้อมูล)
- **ติดตั้งเป็น PWA** — เพิ่มลงหน้าจอโฮมบนมือถือได้ เปิดใช้งานแบบแอปเต็มจอ

## สถาปัตยกรรม

- **Backend**: FastAPI + SQLAlchemy 2.0 (async) + SQLite (ปรับเป็น PostgreSQL ได้ผ่าน `DATABASE_URL`) + JWT auth (PyJWT + bcrypt) + APScheduler (แจ้งเตือนรายวัน) + pywebpush (Web Push)
- **Frontend**: Vanilla JS แบบ static ไม่มี build step, เสิร์ฟเป็นไฟล์ static ผ่าน FastAPI เอง (`StaticFiles`), มี service worker (`sw.js`) สำหรับ push notification และ PWA manifest

### Web Push (การแจ้งเตือน)

ใช้ VAPID keys ที่ตั้งค่าไว้ล่วงหน้าใน `backend/config.py` สำหรับรันในเครื่อง/ทดสอบ — **สำหรับ production ควรสร้างคู่คีย์ใหม่ของตัวเอง** (เช่นผ่านไลบรารี `py_vapid`) แล้ว override ผ่าน environment variables `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_CLAIMS_EMAIL` เพื่อไม่ให้ผู้อื่น sign push แอบอ้างเป็นเซิร์ฟเวอร์นี้ได้ ระบบจะเช็ครายจ่ายประจำที่ใกล้ถึงกำหนด (วันนี้/พรุ่งนี้) ทุกวันตามเวลาที่ตั้งใน `BILL_REMINDER_HOUR` (ค่าเริ่มต้น 8:00)

## รันด้วย Python (dev)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
uvicorn backend.main:app --reload --port 8001
```

เปิด `http://localhost:8001` — บัญชีทดลอง: `demo` / `demo1234` (สร้างอัตโนมัติเมื่อฐานข้อมูลว่าง)

## รันด้วย Docker

```bash
docker compose up --build
```

เปิด `http://localhost:8001`

## โครงสร้างไฟล์

```
backend/
  main.py              # FastAPI entrypoint, mounts routers + static frontend + scheduler
  config.py            # Settings (DATABASE_URL, SECRET_KEY, VAPID keys, ...)
  database.py          # Async SQLAlchemy engine/session
  models.py             # ORM models
  schemas.py            # Pydantic schemas
  auth.py                # JWT (PyJWT) + password hashing (bcrypt)
  seed.py                 # Seeds a demo user on first boot
  push_service.py         # Web push sending + daily due-bill reminder sweep
  recurring_utils.py      # Shared due-date calculation helper
  routers/
    auth.py, transactions.py, recurring_bills.py, credit_cards.py,
    loans.py, dashboard.py, budgets.py, push.py
frontend/
  index.html, app.js, api.js, styles.css, sw.js, manifest.json, icons/
```

## Data model

- `Transaction` — รายรับ/รายจ่ายทุกตัว ไม่ว่าจะเกิดจากการกรอกมือ, การจ่ายรายจ่ายประจำ, หรือการรับชำระหนี้ (`source` บอกที่มา)
- `RecurringBill` + `RecurringBillInstance` — นิยามรายจ่ายประจำ 1 รายการ ผูกกับ instance รายเดือน (1 instance ต่อ 1 period `YYYY-MM`) ที่มีสถานะ `pending`/`paid`/`skipped`
- `CreditCard` — ผูกกับ `Transaction.credit_card_id` เพื่อคำนวณยอดใช้จ่ายรอบบิล
- `Loan` + `LoanPayment` — เงินที่ให้คนอื่นยืม, การรับชำระแต่ละครั้งจะสร้าง `Transaction` ประเภทรายรับอัตโนมัติ
- `Budget` — วงเงินต่อหมวดหมู่ต่อเดือน (unique ต่อ user+category), ยอดใช้จ่ายจริงคำนวณสดจาก `Transaction`
- `PushSubscription` — Web Push subscription ต่ออุปกรณ์/เบราว์เซอร์ของผู้ใช้
