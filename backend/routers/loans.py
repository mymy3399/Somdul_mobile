from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..database import get_db
from ..models import Loan, LoanPayment, Transaction, User
from ..schemas import LoanCreate, LoanOut, LoanPaymentCreate, LoanPaymentOut

router = APIRouter(prefix="/loans", tags=["loans"])

VALID_REPAYMENT_TYPES = {"cash", "monthly_installment", "product_installment"}


async def _with_totals(loan: Loan, db: AsyncSession) -> LoanOut:
    result = await db.execute(
        select(func.coalesce(func.sum(LoanPayment.amount), 0.0)).where(LoanPayment.loan_id == loan.id)
    )
    paid_total = result.scalar_one()
    out = LoanOut.model_validate(loan)
    out.paid_total = paid_total
    out.remaining_balance = loan.principal_amount - paid_total
    return out


@router.get("", response_model=list[LoanOut])
async def list_loans(
    status: str | None = None, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    stmt = select(Loan).where(Loan.user_id == user.id)
    if status:
        stmt = stmt.where(Loan.status == status)
    stmt = stmt.order_by(Loan.loan_date.desc())
    result = await db.execute(stmt)
    loans = result.scalars().all()
    return [await _with_totals(loan, db) for loan in loans]


@router.post("", response_model=LoanOut)
async def create_loan(
    payload: LoanCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    if payload.repayment_type not in VALID_REPAYMENT_TYPES:
        raise HTTPException(status_code=400, detail=f"repayment_type must be one of {VALID_REPAYMENT_TYPES}")
    loan = Loan(user_id=user.id, **payload.model_dump())
    db.add(loan)
    await db.commit()
    await db.refresh(loan)
    return await _with_totals(loan, db)


async def _get_owned_loan(loan_id: int, db: AsyncSession, user: User) -> Loan:
    result = await db.execute(select(Loan).where(Loan.id == loan_id, Loan.user_id == user.id))
    loan = result.scalar_one_or_none()
    if loan is None:
        raise HTTPException(status_code=404, detail="Loan not found")
    return loan


@router.get("/{loan_id}", response_model=LoanOut)
async def get_loan(loan_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    loan = await _get_owned_loan(loan_id, db, user)
    return await _with_totals(loan, db)


@router.put("/{loan_id}", response_model=LoanOut)
async def update_loan(
    loan_id: int, payload: LoanCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    loan = await _get_owned_loan(loan_id, db, user)
    for field, value in payload.model_dump().items():
        setattr(loan, field, value)
    await db.commit()
    await db.refresh(loan)
    return await _with_totals(loan, db)


@router.delete("/{loan_id}")
async def delete_loan(loan_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    loan = await _get_owned_loan(loan_id, db, user)
    await db.delete(loan)
    await db.commit()
    return {"ok": True}


@router.get("/{loan_id}/payments", response_model=list[LoanPaymentOut])
async def list_payments(
    loan_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    await _get_owned_loan(loan_id, db, user)
    result = await db.execute(
        select(LoanPayment).where(LoanPayment.loan_id == loan_id).order_by(LoanPayment.payment_date.desc())
    )
    return result.scalars().all()


@router.post("/{loan_id}/payments", response_model=LoanOut)
async def record_payment(
    loan_id: int,
    payload: LoanPaymentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    loan = await _get_owned_loan(loan_id, db, user)

    # money coming back to the user counts as income
    txn = Transaction(
        user_id=user.id,
        type="income",
        amount=payload.amount,
        category="ชำระหนี้คืน",
        payment_method="cash",
        description=f"รับชำระจาก {loan.borrower_name}",
        txn_date=payload.payment_date,
        source="loan_repayment",
        loan_id=loan.id,
    )
    db.add(txn)
    await db.flush()

    payment = LoanPayment(
        loan_id=loan.id,
        amount=payload.amount,
        payment_date=payload.payment_date,
        notes=payload.notes,
        transaction_id=txn.id,
    )
    db.add(payment)
    await db.flush()

    result = await db.execute(
        select(func.coalesce(func.sum(LoanPayment.amount), 0.0)).where(LoanPayment.loan_id == loan.id)
    )
    paid_total = result.scalar_one()
    if paid_total >= loan.principal_amount:
        loan.status = "completed"

    await db.commit()
    await db.refresh(loan)
    return await _with_totals(loan, db)
