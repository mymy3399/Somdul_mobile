from datetime import datetime, date

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(unique=True, index=True)
    password_hash: Mapped[str]
    display_name: Mapped[str] = mapped_column(default="")
    role: Mapped[str] = mapped_column(default="user")
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)


class CreditCard(Base):
    __tablename__ = "credit_cards"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str]
    bank: Mapped[str] = mapped_column(default="")
    last4: Mapped[str] = mapped_column(default="")
    credit_limit: Mapped[float | None] = mapped_column(default=None)
    statement_day: Mapped[int | None] = mapped_column(default=None)
    due_day: Mapped[int | None] = mapped_column(default=None)
    color: Mapped[str] = mapped_column(default="#6366f1")
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    type: Mapped[str]  # "income" | "expense"
    amount: Mapped[float]
    category: Mapped[str]
    payment_method: Mapped[str] = mapped_column(default="cash")  # cash | transfer | credit_card
    credit_card_id: Mapped[int | None] = mapped_column(ForeignKey("credit_cards.id"), default=None)
    description: Mapped[str] = mapped_column(default="")
    txn_date: Mapped[date]
    source: Mapped[str] = mapped_column(default="manual")  # manual | recurring | loan_repayment | loan_disbursement
    recurring_instance_id: Mapped[int | None] = mapped_column(
        ForeignKey("recurring_bill_instances.id"), default=None
    )
    loan_id: Mapped[int | None] = mapped_column(ForeignKey("loans.id"), default=None)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)


class RecurringBill(Base):
    __tablename__ = "recurring_bills"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str]
    category: Mapped[str]
    amount: Mapped[float]
    due_day: Mapped[int]  # 1-31
    payment_method: Mapped[str] = mapped_column(default="cash")
    credit_card_id: Mapped[int | None] = mapped_column(ForeignKey("credit_cards.id"), default=None)
    is_active: Mapped[bool] = mapped_column(default=True)
    notes: Mapped[str] = mapped_column(default="")
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    instances: Mapped[list["RecurringBillInstance"]] = relationship(
        back_populates="bill", cascade="all, delete-orphan"
    )


class RecurringBillInstance(Base):
    __tablename__ = "recurring_bill_instances"
    __table_args__ = (UniqueConstraint("recurring_bill_id", "period", name="uq_bill_period"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    recurring_bill_id: Mapped[int] = mapped_column(ForeignKey("recurring_bills.id"))
    period: Mapped[str]  # "YYYY-MM"
    due_date: Mapped[date]
    amount: Mapped[float]
    status: Mapped[str] = mapped_column(default="pending")  # pending | paid | skipped
    paid_date: Mapped[date | None] = mapped_column(default=None)
    transaction_id: Mapped[int | None] = mapped_column(default=None)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    bill: Mapped["RecurringBill"] = relationship(back_populates="instances")


class Loan(Base):
    """ยืมเงิน / ลูกหนี้ — money the user has lent to someone else."""

    __tablename__ = "loans"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    borrower_name: Mapped[str]
    principal_amount: Mapped[float]
    loan_date: Mapped[date]
    repayment_type: Mapped[str]  # cash | monthly_installment | product_installment
    item_description: Mapped[str] = mapped_column(default="")  # for product_installment
    installment_amount: Mapped[float | None] = mapped_column(default=None)
    installment_count: Mapped[int | None] = mapped_column(default=None)
    due_day: Mapped[int | None] = mapped_column(default=None)  # for monthly/product installment
    status: Mapped[str] = mapped_column(default="active")  # active | completed
    notes: Mapped[str] = mapped_column(default="")
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    payments: Mapped[list["LoanPayment"]] = relationship(
        back_populates="loan", cascade="all, delete-orphan"
    )


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    endpoint: Mapped[str] = mapped_column(unique=True)
    p256dh: Mapped[str]
    auth: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)


class Budget(Base):
    __tablename__ = "budgets"
    __table_args__ = (UniqueConstraint("user_id", "category", name="uq_budget_user_category"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    category: Mapped[str]
    monthly_limit: Mapped[float]
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)


class LoanPayment(Base):
    __tablename__ = "loan_payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    loan_id: Mapped[int] = mapped_column(ForeignKey("loans.id"))
    amount: Mapped[float]
    payment_date: Mapped[date]
    notes: Mapped[str] = mapped_column(default="")
    transaction_id: Mapped[int | None] = mapped_column(default=None)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    loan: Mapped["Loan"] = relationship(back_populates="payments")
