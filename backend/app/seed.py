from decimal import Decimal
from sqlmodel import Session, select, SQLModel
from app.database import engine
from app.models import User, Wallet, CreditCard, Debtor, Debt, Transaction, RecurringPayment
from app.security import get_password_hash

def seed_db():
    print("Initializing database seeding...")
    SQLModel.metadata.create_all(engine)
    
    with Session(engine) as session:
        # Check if the demo user already exists
        demo_email = "demo@somdul.com"
        user = session.exec(select(User).where(User.email == demo_email)).first()
        if user:
            print("Database already seeded. Cleaning up for fresh seed...")
            session.delete(user)
            session.commit()
            
        print("Creating demo user...")
        hashed_password = get_password_hash("password123")
        user = User(
            name="คุณสมดุล",
            email=demo_email,
            hashed_password=hashed_password
        )
        session.add(user)
        session.flush() # Populate user.id
        
        # 1. Create Wallets
        print("Creating wallets...")
        w_cash = Wallet(
            user_id=user.id,
            wallet_name="เงินสดพกพา",
            wallet_type="CASH",
            balance=Decimal("1250.00")
        )
        w_scb = Wallet(
            user_id=user.id,
            wallet_name="บัญชี SCB",
            wallet_type="BANK_ACCOUNT",
            balance=Decimal("24500.00")
        )
        w_truemoney = Wallet(
            user_id=user.id,
            wallet_name="TrueMoney Wallet",
            wallet_type="E_WALLET",
            balance=Decimal("450.00")
        )
        session.add_all([w_cash, w_scb, w_truemoney])
        session.flush()
        
        # 2. Create Credit Cards
        print("Creating credit cards...")
        c_kbank = CreditCard(
            user_id=user.id,
            card_name="KBank Shopee",
            billing_cycle_day=10,
            due_day=25,
            credit_limit=Decimal("50000.00"),
            current_balance=Decimal("12000.00")
        )
        c_citi = CreditCard(
            user_id=user.id,
            card_name="Citi Grab",
            billing_cycle_day=5,
            due_day=20,
            credit_limit=Decimal("30000.00"),
            current_balance=Decimal("4500.00")
        )
        session.add_all([c_kbank, c_citi])
        session.flush()
        
        # 3. Create Debtors
        print("Creating debtors...")
        d_boy = Debtor(
            user_id=user.id,
            debtor_name="เพื่อนบอย (ที่ทำงาน)",
            contact_info="089-123-4567"
        )
        d_biw = Debtor(
            user_id=user.id,
            debtor_name="น้องบิว (ฝั่งการเงิน)",
            contact_info="Line: biw.money"
        )
        d_ace = Debtor(
            user_id=user.id,
            debtor_name="เอส เพื่อนมหาลัย",
            contact_info="081-987-6543"
        )
        session.add_all([d_boy, d_biw, d_ace])
        session.flush()
        
        # 4. Create Debts
        print("Creating debts...")
        debt1 = Debt(
            debtor_id=d_boy.id,
            debt_type="CREDIT_CARD_INSTALLMENT",
            credit_card_id=c_kbank.id,
            total_amount=Decimal("15000.00"),
            remaining_amount=Decimal("6000.00"),
            total_installments=10,
            remaining_installments=4,
            due_day=25,
            memo="ผ่อนช่วยแชร์ iPad Air ให้เพื่อนบอย",
            status="UNPAID"
        )
        debt2 = Debt(
            debtor_id=d_biw.id,
            debt_type="CASH_LOAN",
            credit_card_id=None,
            total_amount=Decimal("3500.00"),
            remaining_amount=Decimal("3500.00"),
            total_installments=1,
            remaining_installments=1,
            due_day=20,
            memo="ค่ายืมจ่ายร้านส้มตำและหมูกระทะยามเย็น",
            status="UNPAID"
        )
        debt3 = Debt(
            debtor_id=d_ace.id,
            debt_type="CASH_LOAN",
            credit_card_id=None,
            total_amount=Decimal("8000.00"),
            remaining_amount=Decimal("4000.00"),
            total_installments=4,
            remaining_installments=2,
            due_day=10,
            memo="ยืมเงินสมทบทุนฉุกเฉินช่วยผ่อนคอม",
            status="UNPAID"
        )
        session.add_all([debt1, debt2, debt3])
        session.flush()
        
        # 5. Create Transactions
        print("Creating transactions...")
        tx1 = Transaction(
            user_id=user.id,
            tx_type="EXPENSE",
            description="ซื้อกาแฟโบราณ",
            category="FOOD",
            amount=Decimal("65.00"),
            wallet_id=w_cash.id
        )
        tx2 = Transaction(
            user_id=user.id,
            tx_type="INCOME",
            description="เพื่อนบอยโอนเงินคืนงวด 6/10",
            category="REFUND",
            amount=Decimal("1500.00"),
            wallet_id=w_scb.id
        )
        tx3 = Transaction(
            user_id=user.id,
            tx_type="EXPENSE",
            description="รูดจ่ายค่าอาหารค่ำเพื่อนเลี้ยงบัตร",
            category="FOOD",
            amount=Decimal("1200.00"),
            credit_card_id=c_kbank.id
        )
        session.add_all([tx1, tx2, tx3])
        
        # 6. Create Recurring Payments (Subscriptions)
        print("Creating recurring payments...")
        rec1 = RecurringPayment(
            user_id=user.id,
            name="Netflix Premium Family",
            amount=Decimal("419.00"),
            due_day=28,
            status="WAITING"
        )
        rec2 = RecurringPayment(
            user_id=user.id,
            name="ค่าส่วนกลาง คอนโด",
            amount=Decimal("1200.00"),
            due_day=5,
            status="WAITING"
        )
        rec3 = RecurringPayment(
            user_id=user.id,
            name="Spotify Premium",
            amount=Decimal("139.00"),
            due_day=15,
            status="PAID"
        )
        session.add_all([rec1, rec2, rec3])
        
        session.commit()
        print("Database successfully seeded with demo data!")

if __name__ == "__main__":
    seed_db()
