Product Requirement Document (PRD) -
แอปพลเคช ิ น

ั Somdul (สมดลุ )

เอกสารฉบบั นจ
ี้ ัดทํา ขน
ึ้
เพอ
ื่ ใชเ้ป็นพมิ พเ์ขยี ว (Blueprint) ในการสรา้งแอปพลเิคชนั บรหิ ารจัดการการเงนิ สว่ น

บคุ คล บตั รเครดติ รายการจา่ ยซ้ํา และระบบจัดการลกู หนท
ี้
กุ รปู แบบ (เชน่ ยมืเงนิ สด ผอ่ นสนิคา้ หรอื แชรห์ น
ี้

บตั รเครดติ)
1. ภาพรวมของโครงการ (Project Overview)
แอปพลเิคชนั Somdul (สมดลุ ) ออกแบบมาเพอ

ื่ ปิดชอ่ งวา่ งของการเงนิ สว่ นบคุ คล โดยเฉพาะกลมุ่ คนใน

ปัจจบุ นั ทม
ี่
คี า่ ใชจ้า่ ยจกุ จกิ เชน่ คา่ Subscription บรกิ ารตา่ งๆ, มพี ฤตกิ รรมการจา่ ยเงนิ ผา่ นบตั รเครดติเพอ
ื่

สะสมแตม้ , และมสี ถานการณใ์ นชวีติ ประจํา วนั เชน่ การรดู ซอ
ื้
สนิคา้ชน
ิ้ ใหญใ่ หเ้พอ
ื่
นกอ่ นแลว้ทยอยผอ่ นจา่ ย

หรอื การใหบ้ คุ คลอน
ื่
ยมืเงนิ สด ซง
ึ่
การบนั ทกึแบบเดมิ ไมต่ อบโจทยค์ วามเกย
ี่
วพันของการโอนและการรับเงนิ

เหลา่ น
ี้
2. สถาปตยกรรม ั ฐานขอม้ ลู และสกมาี (Database Schema)
โครงสรา้งขอ้มลู นพ
ี้
รอ้ มสง่ ตอ่ ใหน้ ักพัฒนาซอฟตแ์ วรน์ ํา ไปตดิ ตงั้ ในระบบฐานขอ้มลู (เชน่ PostgreSQL)

เพอ
ื่
เรม
ิ่
ตน้ การเขยีนโปรแกรม
ตาราง: Users (ผใู้ชง้านหลกั )

ชอ
ื่ ฟิลด์(Field Name) ประเภทขอ้ มลู (Data Type) คําอธบิ าย (Description)

id UUID (PK) ไอดหี ลกั ประจํา ตวัผใู้ช ้

name VARCHAR(100) ชอ

ื่ โปรไฟลผ์ ใู้ชง้าน

email VARCHAR(255) อเีมลสํา หรับระบตุ วัตนและเขา้สู่

ระบบ

ตาราง: Wallets (บญั ช/ีกระเป๋าเงนิ สด)

ชอ
ื่ ฟิลด์(Field Name) ประเภทขอ้ มลู (Data Type) คําอธบิ าย (Description)

id UUID (PK) ไอดหี ลกั ของกระเป๋าเงนิ

user_id UUID (FK) ผกู กบั ตาราง Users

wallet_name VARCHAR(100) ชอ
ื่
กระเป๋า (เชน่ บญั ชีSCB,
เงนิ สดพกพา, TrueMoney)

wallet_type VARCHAR(50) ประเภทบญั ชี(CASH, BANK,

E_WALLET)

balance DECIMAL(15,2) ยอดเงนิ คงเหลอื ปัจจบุ นั

ตาราง: Credit_Cards (บตัรเครดติ )

ชอ
ื่ ฟิลด์(Field Name) ประเภทขอ้ มลู (Data Type) คําอธบิ าย (Description)

id UUID (PK) ไอดขี องบตั รเครดติ

user_id UUID (FK) ผกู กบั ผใู้ชง้าน

card_name VARCHAR(100) ชอ
ื่
บตั รเครดติ (เชน่ Citi Grab,
KTC Platinum)

billing_cycle_day INT วนั ทต
ี่
ดั รอบบลิ ประจํา เดอื น
(1-31)

ชอ
ื่ ฟิลด์(Field Name) ประเภทขอ้ มลู (Data Type) คําอธบิ าย (Description)

due_day INT วนั ทค
ี่
รบกํา หนดชําระจรงิ
(1-31)
credit_limit DECIMAL(15,2) วงเงนิ บตั รทงั้หมด

current_balance DECIMAL(15,2) ยอดหนร
ี้
ดู คา้งจา่ ยปัจจบุ นั

ตาราง: Debtors (กลมุ่ ลกู หน/ี้ผยู้ มื )

ชอ
ื่ ฟิลด์(Field Name) ประเภทขอ้ มลู (Data Type) คําอธบิ าย (Description)

id UUID (PK) ไอดรีะบลุ กู หน
ี้

user_id UUID (FK) เจา้หน

ี้(ผใู้ชร้ะบบ)

debtor_name VARCHAR(100) ชอ
ื่
เลน่ หรอื ชอ
ื่
สํา หรับทวงของ

ลกู หน
ี้

contact_info VARCHAR(255) เบอรม์ อื ถอื หรอื Line ID
(สํา หรับแชรส์ รปุ ทวงถาม)

ตาราง: Debts (ยอดหนที้ ง
ั้
หมดและการผอ่ นชํา ระ)

ชอ
ื่ ฟิลด์(Field Name) ประเภทขอ้ มลู (Data Type) คําอธบิ าย (Description)

id UUID (PK) ไอดหี ลกั ของยอดหน
ี้

ชอ
ื่ ฟิลด์(Field Name) ประเภทขอ้ มลู (Data Type) คําอธบิ าย (Description)

debtor_id UUID (FK) ผกู กบั ตาราง Debtors

debt_type ENUM 'CASH_LOAN' (ยมืเงนิ สด),
'CREDIT_CARD_INSTALLM
ENT' (ผอ่ นบตั ร)
credit_card_id UUID (FK, Nullable) บตั รเครดติ ทใี่ ชร้ดู ซอ
ื้ (กรณีรดู

ผอ่ นแทนเพอ
ื่
น)
total_amount DECIMAL(15,2) จํา นวนเงนิ ทงั้หมดทย
ี่
มื/ทํา

สญั ญาผอ่ น

remaining_amount DECIMAL(15,2) จํา นวนหนค
ี้
งเหลอื ทย
ี่
งัไมไ่ ดร้ับ

ชําระคนื

total_installments INT จํา นวนงวดทต
ี่
กลงกนั ไว ้(กรณี
จา่ ยงวดเดยี วใหใ้ส่ 1)

remaining_installments INT จํา นวนงวดผอ่ นชําระทเ
ี่
หลอื อยู่

status VARCHAR(50) สถานะหน

ี้(UNPAID,
PARTIALLY_PAID, PAID)
3. โคดต้ นแบบ ้ สําหรบัการวางระบบฐานขอม้ ลู (SQL Tables
Creation)
ทมี นักพัฒนาซอฟตแ์ วรส์ ามารถคดั ลอกสว่ นโคด้ ดา้นลา่ งนเ
ี้
พอ
ื่ ใชส้ รา้งชดุ ฐานขอ้มลู ในฝั่

ง Backend ไดใ้น

ขนั้ ตอนเดยี ว:
CREATE TABLE Users (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
name VARCHAR(100) NOT NULL,

email VARCHAR(255) UNIQUE NOT NULL,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE Wallets (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
user_id UUID REFERENCES Users(id) ON DELETE CASCADE,
wallet_name VARCHAR(100) NOT NULL,
wallet_type VARCHAR(50) CHECK (wallet_type IN ('CASH', 'BANK_ACCOUNT',
'E_WALLET')),
balance DECIMAL(15,2) DEFAULT 0.00
);
CREATE TABLE Credit_Cards (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
user_id UUID REFERENCES Users(id) ON DELETE CASCADE,
card_name VARCHAR(100) NOT NULL,
billing_cycle_day INT CHECK (billing_cycle_day BETWEEN 1 AND 31),
due_day INT CHECK (due_day BETWEEN 1 AND 31),
credit_limit DECIMAL(15,2) NOT NULL,
current_balance DECIMAL(15,2) DEFAULT 0.00
);
CREATE TABLE Debtors (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
user_id UUID REFERENCES Users(id) ON DELETE CASCADE,
debtor_name VARCHAR(100) NOT NULL,
contact_info VARCHAR(255)
);
CREATE TABLE Debts (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
debtor_id UUID REFERENCES Debtors(id) ON DELETE CASCADE,
debt_type VARCHAR(50) CHECK (debt_type IN ('CASH_LOAN',
'CREDIT_CARD_INSTALLMENT')),
credit_card_id UUID REFERENCES Credit_Cards(id) ON DELETE SET NULL,
total_amount DECIMAL(15,2) NOT NULL,
remaining_amount DECIMAL(15,2) NOT NULL,
total_installments INT DEFAULT 1,

remaining_installments INT DEFAULT 1,
status VARCHAR(50) CHECK (status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID')),
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

4. เสนทาง ้ การดําเนนิ งานทสี่

ําคญั ของระบบ (Key User

Flows)
นค
ี่
อื รายละเอยีดตรรกะระบบเบอ
ื้
งหลงัการทํา งาน (Logic) ของฟังกช์ นั จัดการลกู หนท
ี้ ซี่
บั ซอ้น เพอ
ื่ ใหน้ ัก

พัฒนาสามารถเขยีนโคด้ ไดต้ รงตามความคาดหวงั:
กรณีท
ี่A: รดู บตัรเครดติ ผอ่ นแทนเพอ
ื่
น (Credit Card Installment Sharing)

1. ผใู้ชบ้ นั ทกึธรุ กรรมโดยระบเุ ป็นรายจา่ ย "รดู แทนเพอ
ื่
น" หรอื "ใหย้มื"
2. ระบชุ อ่ งทางชําระเงนิเป็น "บตัรเครดติ ใบทใี่ ชช้ ํา ระจรงิ"
3. ระบชุ อ
ื่
ลกู หนค
ี้
นนัน้ (หากเป็นคนใหม่ ระบบจะบนั ทกึ เขา้หนา้ฐานขอ้มลู เพอ
ื่
นไวด้ ว้ยอตั โนมตั )ิ
4. กํา หนดการแบง่ ชําระเป็น "ผอ่ นรายงวด" ระบยุ อดและจํา นวนเดอื น (เชน่ 12,000 บาท ผอ่ น 10
เดอื น เดอื นละ 1,200 บาท)
5. การตอบสนองของแอปพลเิคชนั :
○ ยอดของบตั รเครดติ ใบนัน้ จะมยีอดเงนิ ทถ
ี่
กู ใชไ้ปเพม
ิ่
ขน
ึ้ 12,000 บาททนั ทใีนระบบเพอ
ื่
เตอื น

ใหเ้จา้ของบตั รเตรยีมเงนิ มาจา่ ยธนาคารตามรอบบลิ
○ ยอดลกู หนจ
ี้
ะงอกเพม
ิ่
มา 12,000 บาท โดยมแีผนชําระเงนิ สบิเดอื นผกู ไว ้

กรณีท
ี่B: การกดคนื เงนิ สดหรอื รบัคนื เงนิ ผอ่ น
1. เมอ
ื่
ลกู หนห
ี้
รอืเพอ
ื่
นโอนเงนิ มาคนื ใหผ้ ใู้ชแ้ตะป่มุ "รบัชํา ระคนื " ทปี่

ระวตั ลิ กู หน
ี้
หรอื รายการงวด

ประจํา เดอื นนัน้ ๆ
2. ระบบุ ญั ชธีนาคารปลายทางทร

ี่ ับเงนิ จรงิ (เพอ
ื่
เพม
ิ่
เงนิ สดสํา รองจรงิใหก้บั ผใู้ชง้าน)

3. การตอบสนองของแอปพลเิคชนั :
○ เงนิ สดในกระเป๋า/บญั ชผี ใู้ชจ้ะเพม
ิ่
ขน
ึ้
จรงิตามยอดทเ
ี่
พอ
ื่
นคนื มา

○ หนฝี้ ั่
งลกู หนจ
ี้
ะลดลงตามสดั สว่ น (และขยบั จํา นวนงวดคา้งชําระใหอ้ตั โนมตั ใินกรณีหนร
ี้
าย

งวด)

5. แนวคดิ อนิ เตอรเฟสและ ์ ฟีเจอรเด์ น่ (UX/UI Highlights)
● Safe-to-Spend Balance: แสดงจํา นวนยอดเงนิ ทผ

ี่ ใู้ชง้านใชไ้ดช้ อ้ปปิ้

งไดอ้ยา่ งสบายใจจรงิ

หลงัจากทร
ี่
ะบบคํา นวณหกั ลบคา่ ใชจ้า่ ยคงทร
ี่
ายเดอื น (Subscription) และยอดบตั รเครดติ รอบ

ปัจจบุ นั ทร
ี่
อจา่ ยแลว้

● Shareable Slip Generator: ป่มุ ผลติ รปู การด์ ทวงหนแ
ี้
บบสภุ าพและน่ารัก เพอ
ื่
ความสะดวกสบาย
ใจในการเซฟแลว้แชรผ์ า่ นชอ่ งทาง Line/Messenger ปราศจากความอดึอดั เวลากดพมิ พท์ วงหน
ี้

ตรงๆ
● Debtor Timeline Tracker: ปฏทิ นิ แสดงรอบการรับเงนิ คนื ทใี่

กลจ้ะถงึ เพอ
ื่
การบรหิ ารสภาพคลอ่ ง

ทางการเงนิ ลว่ งหนา้ของเจา้ของเครอ
ื่
งอยา่ งเป็นระบบ
