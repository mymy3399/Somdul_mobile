import csv
import io
from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select
from pydantic import BaseModel
from decimal import Decimal
from datetime import datetime

from app.database import get_session
from app.models import Transaction, Wallet, CreditCard, Category, User
from app.security import get_current_user

router = APIRouter(prefix="/transactions", tags=["Transactions"])

# ----------------------------------------------------
# SCHEMAS
# ----------------------------------------------------
class TransactionResponseSchema(BaseModel):
    id: UUID
    tx_type: str # INCOME, EXPENSE
    description: str
    category: str
    amount: Decimal
    wallet_id: Optional[UUID] = None
    credit_card_id: Optional[UUID] = None
    created_at: datetime

    class Config:
        from_attributes = True

class TransactionCreateSchema(BaseModel):
    tx_type: str # INCOME, EXPENSE
    description: str
    category: str
    amount: Decimal
    wallet_id: Optional[UUID] = None
    credit_card_id: Optional[UUID] = None

class MonthlySummarySchema(BaseModel):
    month: str  # "YYYY-MM"
    income: Decimal
    expense: Decimal

# ----------------------------------------------------
# ROUTERS
# ----------------------------------------------------

@router.get("/summary/monthly", response_model=List[MonthlySummarySchema])
def monthly_summary(
    months: int = 6,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Income/expense totals for each of the last `months` calendar months,
    aggregated in Python rather than a DB-specific date_trunc so this works
    the same on Postgres (prod) and SQLite (tests)."""
    now = datetime.utcnow()
    cutoff_year, cutoff_month = now.year, now.month - (months - 1)
    while cutoff_month <= 0:
        cutoff_month += 12
        cutoff_year -= 1
    cutoff = datetime(cutoff_year, cutoff_month, 1)

    stmt = select(Transaction).where(Transaction.user_id == current_user.id, Transaction.created_at >= cutoff)
    buckets: dict[str, dict[str, Decimal]] = {}
    for tx in session.exec(stmt).all():
        key = f"{tx.created_at.year:04d}-{tx.created_at.month:02d}"
        bucket = buckets.setdefault(key, {"income": Decimal("0"), "expense": Decimal("0")})
        if tx.tx_type in ("INCOME", "EXPENSE"):
            bucket[tx.tx_type.lower()] += tx.amount

    result = []
    y, m = cutoff_year, cutoff_month
    for _ in range(months):
        key = f"{y:04d}-{m:02d}"
        bucket = buckets.get(key, {"income": Decimal("0"), "expense": Decimal("0")})
        result.append(MonthlySummarySchema(month=key, income=bucket["income"], expense=bucket["expense"]))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return result


@router.get("/export")
def export_transactions_csv(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    wallet_names = {w.id: w.wallet_name for w in session.exec(select(Wallet).where(Wallet.user_id == current_user.id)).all()}
    card_names = {c.id: c.card_name for c in session.exec(select(CreditCard).where(CreditCard.user_id == current_user.id)).all()}
    category_names = {c.key: c.name for c in session.exec(select(Category).where(Category.user_id == current_user.id)).all()}

    stmt = select(Transaction).where(Transaction.user_id == current_user.id).order_by(Transaction.created_at.desc())
    transactions = session.exec(stmt).all()

    buffer = io.StringIO()
    buffer.write("﻿")  # UTF-8 BOM so Excel renders Thai text correctly
    writer = csv.writer(buffer)
    writer.writerow(["วันที่", "ประเภท", "รายละเอียด", "หมวดหมู่", "จำนวนเงิน", "แหล่งเงิน"])

    for tx in transactions:
        if tx.wallet_id:
            source = wallet_names.get(tx.wallet_id, "-")
        elif tx.credit_card_id:
            source = f"บัตรเครดิต: {card_names.get(tx.credit_card_id, '-')}"
        else:
            source = "-"
        writer.writerow([
            tx.created_at.strftime("%Y-%m-%d %H:%M"),
            "รายรับ" if tx.tx_type == "INCOME" else "รายจ่าย",
            tx.description,
            category_names.get(tx.category, tx.category),
            f"{tx.amount:.2f}",
            source,
        ])

    buffer.seek(0)
    filename = f"somdul-transactions-{datetime.utcnow().strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

@router.get("", response_model=List[TransactionResponseSchema])
def list_transactions(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    stmt = select(Transaction).where(Transaction.user_id == current_user.id).order_by(Transaction.created_at.desc())
    return session.exec(stmt).all()

@router.post("", response_model=TransactionResponseSchema, status_code=status.HTTP_201_CREATED)
def create_transaction(
    data: TransactionCreateSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="Transaction amount must be positive")
        
    if not data.wallet_id and not data.credit_card_id:
        raise HTTPException(status_code=400, detail="Either wallet_id or credit_card_id must be provided")

    # Resolve wallet/credit_card and apply balances
    wallet = None
    card = None
    
    if data.wallet_id:
        wallet_stmt = select(Wallet).where(Wallet.id == data.wallet_id, Wallet.user_id == current_user.id)
        wallet = session.exec(wallet_stmt).first()
        if not wallet:
            raise HTTPException(status_code=404, detail="Selected wallet not found")
            
        if data.tx_type == "EXPENSE":
            if wallet.balance < data.amount:
                # We can block or allow negative balances. Let's block it for safety or allow.
                # In most cash wallets, going negative is an error, so let's check.
                raise HTTPException(status_code=400, detail="Insufficient wallet balance")
            wallet.balance -= data.amount
        elif data.tx_type == "INCOME":
            wallet.balance += data.amount
        else:
            raise HTTPException(status_code=400, detail="Invalid transaction type")
        session.add(wallet)
        
    elif data.credit_card_id:
        card_stmt = select(CreditCard).where(CreditCard.id == data.credit_card_id, CreditCard.user_id == current_user.id)
        card = session.exec(card_stmt).first()
        if not card:
            raise HTTPException(status_code=404, detail="Selected credit card not found")
            
        if data.tx_type == "EXPENSE":
            card.current_balance += data.amount
        elif data.tx_type == "INCOME":
            card.current_balance -= data.amount
            if card.current_balance < 0:
                card.current_balance = Decimal("0.00")
        else:
            raise HTTPException(status_code=400, detail="Invalid transaction type")
        session.add(card)

    # Log the transaction
    new_tx = Transaction(
        user_id=current_user.id,
        tx_type=data.tx_type,
        description=data.description,
        category=data.category.upper(),
        amount=data.amount,
        wallet_id=data.wallet_id,
        credit_card_id=data.credit_card_id,
        created_at=datetime.utcnow()
    )
    
    session.add(new_tx)
    session.commit()
    session.refresh(new_tx)
    return new_tx

@router.delete("/{tx_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(
    tx_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    tx_stmt = select(Transaction).where(Transaction.id == tx_id, Transaction.user_id == current_user.id)
    tx = session.exec(tx_stmt).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    session.delete(tx)
    session.commit()
