from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


# ---------- Auth ----------
class UserCreate(BaseModel):
    username: str
    password: str
    display_name: str = ""


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    display_name: str
    role: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------- Credit cards ----------
class CreditCardCreate(BaseModel):
    name: str
    bank: str = ""
    last4: str = ""
    credit_limit: float | None = None
    statement_day: int | None = None
    due_day: int | None = None
    color: str = "#6366f1"


class CreditCardUpdate(CreditCardCreate):
    is_active: bool = True


class CreditCardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    bank: str
    last4: str
    credit_limit: float | None
    statement_day: int | None
    due_day: int | None
    color: str
    is_active: bool


# ---------- Transactions ----------
class TransactionCreate(BaseModel):
    type: str  # income | expense
    amount: float
    category: str
    payment_method: str = "cash"
    credit_card_id: int | None = None
    description: str = ""
    txn_date: date


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    type: str
    amount: float
    category: str
    payment_method: str
    credit_card_id: int | None
    description: str
    txn_date: date
    source: str
    loan_id: int | None
    created_at: datetime


class TransactionSummary(BaseModel):
    period: str
    total_income: float
    total_expense: float
    balance: float
    by_category: dict[str, float]


# ---------- Recurring bills ----------
class RecurringBillCreate(BaseModel):
    name: str
    category: str
    amount: float
    due_day: int
    payment_method: str = "cash"
    credit_card_id: int | None = None
    notes: str = ""


class RecurringBillUpdate(RecurringBillCreate):
    is_active: bool = True


class RecurringBillOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    category: str
    amount: float
    due_day: int
    payment_method: str
    credit_card_id: int | None
    is_active: bool
    notes: str


class RecurringBillInstanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    recurring_bill_id: int
    period: str
    due_date: date
    amount: float
    status: str
    paid_date: date | None
    bill_name: str = ""


# ---------- Loans ----------
class LoanCreate(BaseModel):
    borrower_name: str
    principal_amount: float
    loan_date: date
    repayment_type: str  # cash | monthly_installment | product_installment
    item_description: str = ""
    installment_amount: float | None = None
    installment_count: int | None = None
    due_day: int | None = None
    notes: str = ""


class LoanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    borrower_name: str
    principal_amount: float
    loan_date: date
    repayment_type: str
    item_description: str
    installment_amount: float | None
    installment_count: int | None
    due_day: int | None
    status: str
    notes: str
    paid_total: float = 0.0
    remaining_balance: float = 0.0


class LoanPaymentCreate(BaseModel):
    amount: float
    payment_date: date
    notes: str = ""


class LoanPaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    loan_id: int
    amount: float
    payment_date: date
    notes: str


# ---------- Push notifications ----------
class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionCreate(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys


# ---------- Budgets ----------
class BudgetCreate(BaseModel):
    category: str
    monthly_limit: float


class BudgetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    category: str
    monthly_limit: float
    spent: float = 0.0


# ---------- Trend ----------
class TrendPoint(BaseModel):
    period: str
    total_income: float
    total_expense: float


# ---------- Dashboard ----------
class DashboardOut(BaseModel):
    period: str
    total_income: float
    total_expense: float
    balance: float
    pending_bills_count: int
    pending_bills_amount: float
    credit_card_outstanding: float
    loans_outstanding: float
    recent_transactions: list[TransactionOut]
