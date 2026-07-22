from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select
from pydantic import BaseModel
from decimal import Decimal
from datetime import datetime

from app.database import get_session
from app.models import RecurringPayment, Wallet, Transaction, User
from app.security import get_current_user

router = APIRouter(prefix="/recurring-payments", tags=["Recurring Payments (Subscriptions)"])


def _reconcile_billing_cycle(session: Session, user_id: UUID) -> None:
    """Flip PAID subscriptions back to WAITING once a new calendar month has
    started since they were last paid, so each subscription reflects its own
    monthly billing cycle instead of staying PAID forever after one payment."""
    now = datetime.utcnow()
    stmt = select(RecurringPayment).where(
        RecurringPayment.user_id == user_id,
        RecurringPayment.status == "PAID",
    )
    changed = False
    for rec in session.exec(stmt).all():
        if rec.last_paid_at and (rec.last_paid_at.year, rec.last_paid_at.month) != (now.year, now.month):
            rec.status = "WAITING"
            session.add(rec)
            changed = True
    if changed:
        session.commit()

class RecurringCreateSchema(BaseModel):
    name: str
    amount: Decimal
    due_day: int

class RecurringResponseSchema(BaseModel):
    id: UUID
    name: str
    amount: Decimal
    due_day: int
    status: str

    class Config:
        from_attributes = True

class PayRecurringSchema(BaseModel):
    wallet_id: UUID

@router.get("", response_model=List[RecurringResponseSchema])
def list_recurring(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    _reconcile_billing_cycle(session, current_user.id)
    stmt = select(RecurringPayment).where(RecurringPayment.user_id == current_user.id)
    return session.exec(stmt).all()

@router.post("", response_model=RecurringResponseSchema, status_code=status.HTTP_201_CREATED)
def create_recurring(
    data: RecurringCreateSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    new_rec = RecurringPayment(
        user_id=current_user.id,
        name=data.name,
        amount=data.amount,
        due_day=data.due_day,
        status="WAITING"
    )
    session.add(new_rec)
    session.commit()
    session.refresh(new_rec)
    return new_rec

@router.delete("/{rec_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recurring(
    rec_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    stmt = select(RecurringPayment).where(RecurringPayment.id == rec_id, RecurringPayment.user_id == current_user.id)
    rec = session.exec(stmt).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Subscription not found")
    
    session.delete(rec)
    session.commit()
    return

@router.post("/{rec_id}/pay", response_model=RecurringResponseSchema)
def pay_recurring(
    rec_id: UUID,
    data: PayRecurringSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    # Fetch subscription
    rec_stmt = select(RecurringPayment).where(RecurringPayment.id == rec_id, RecurringPayment.user_id == current_user.id)
    rec = session.exec(rec_stmt).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Subscription not found")
        
    if rec.status == "PAID":
        raise HTTPException(status_code=400, detail="Subscription is already paid for this cycle")
        
    # Fetch wallet
    wallet_stmt = select(Wallet).where(Wallet.id == data.wallet_id, Wallet.user_id == current_user.id)
    wallet = session.exec(wallet_stmt).first()
    if not wallet:
        raise HTTPException(status_code=404, detail="Selected wallet not found")
        
    if wallet.balance < rec.amount:
        raise HTTPException(status_code=400, detail="Insufficient wallet balance")
        
    # Deduct wallet, set paid
    wallet.balance -= rec.amount
    rec.status = "PAID"
    rec.last_paid_at = datetime.utcnow()
    
    # Create transaction
    tx = Transaction(
        user_id=current_user.id,
        tx_type="EXPENSE",
        description=f"จ่ายตัดเงินอัตโนมัติ: {rec.name}",
        category="SUBSCRIPTION",
        amount=rec.amount,
        wallet_id=wallet.id,
        created_at=datetime.utcnow()
    )
    
    session.add(wallet)
    session.add(rec)
    session.add(tx)
    session.commit()
    session.refresh(rec)
    return rec
