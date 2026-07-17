from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..database import get_db
from ..models import Loan, LoanPayment, RecurringBillInstance, RecurringBill, Transaction, User
from ..schemas import DashboardOut, TransactionOut

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardOut)
async def dashboard_summary(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    period = date.today().strftime("%Y-%m")

    txn_result = await db.execute(
        select(Transaction).where(
            Transaction.user_id == user.id,
            func.strftime("%Y-%m", Transaction.txn_date) == period,
        )
    )
    txns = txn_result.scalars().all()
    total_income = sum(t.amount for t in txns if t.type == "income")
    total_expense = sum(t.amount for t in txns if t.type == "expense")

    pending_result = await db.execute(
        select(RecurringBillInstance)
        .join(RecurringBill, RecurringBillInstance.recurring_bill_id == RecurringBill.id)
        .where(RecurringBill.user_id == user.id, RecurringBillInstance.status == "pending")
    )
    pending = pending_result.scalars().all()

    cc_result = await db.execute(
        select(func.coalesce(func.sum(Transaction.amount), 0.0)).where(
            Transaction.user_id == user.id,
            Transaction.type == "expense",
            Transaction.payment_method == "credit_card",
            func.strftime("%Y-%m", Transaction.txn_date) == period,
        )
    )
    credit_card_outstanding = cc_result.scalar_one()

    loans_result = await db.execute(select(Loan).where(Loan.user_id == user.id, Loan.status == "active"))
    active_loans = loans_result.scalars().all()
    loans_outstanding = 0.0
    for loan in active_loans:
        paid_result = await db.execute(
            select(func.coalesce(func.sum(LoanPayment.amount), 0.0)).where(LoanPayment.loan_id == loan.id)
        )
        paid = paid_result.scalar_one()
        loans_outstanding += loan.principal_amount - paid

    recent_result = await db.execute(
        select(Transaction)
        .where(Transaction.user_id == user.id)
        .order_by(Transaction.txn_date.desc(), Transaction.id.desc())
        .limit(10)
    )
    recent = recent_result.scalars().all()

    return DashboardOut(
        period=period,
        total_income=total_income,
        total_expense=total_expense,
        balance=total_income - total_expense,
        pending_bills_count=len(pending),
        pending_bills_amount=sum(p.amount for p in pending),
        credit_card_outstanding=credit_card_outstanding,
        loans_outstanding=loans_outstanding,
        recent_transactions=[TransactionOut.model_validate(t) for t in recent],
    )
