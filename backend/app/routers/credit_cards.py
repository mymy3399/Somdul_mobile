from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from pydantic import BaseModel
from decimal import Decimal
from datetime import datetime

from app.database import get_session
from app.models import CreditCard, Wallet, Transaction, User
from app.security import get_current_user

router = APIRouter(prefix="/credit-cards", tags=["Credit Cards"])

class CreditCardCreateSchema(BaseModel):
    card_name: str
    billing_cycle_day: int
    due_day: int
    credit_limit: Decimal
    current_balance: Decimal = Decimal("0.00")

class CreditCardUpdateSchema(BaseModel):
    card_name: str
    billing_cycle_day: int
    due_day: int
    credit_limit: Decimal
    current_balance: Decimal

class CreditCardResponseSchema(BaseModel):
    id: UUID
    card_name: str
    billing_cycle_day: int
    due_day: int
    credit_limit: Decimal
    current_balance: Decimal

    class Config:
        from_attributes = True

class CardPaymentSchema(BaseModel):
    wallet_id: UUID
    amount: Decimal

@router.get("", response_model=List[CreditCardResponseSchema])
async def list_credit_cards(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    statement = select(CreditCard).where(CreditCard.user_id == current_user.id, CreditCard.deleted_at == None)
    result = await session.exec(statement)
    return result.all()

@router.post("", response_model=CreditCardResponseSchema, status_code=status.HTTP_201_CREATED)
async def create_credit_card(
    data: CreditCardCreateSchema,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    new_card = CreditCard(
        user_id=current_user.id,
        card_name=data.card_name,
        billing_cycle_day=data.billing_cycle_day,
        due_day=data.due_day,
        credit_limit=data.credit_limit,
        current_balance=data.current_balance
    )
    session.add(new_card)
    await session.commit()
    await session.refresh(new_card)
    return new_card

@router.put("/{card_id}", response_model=CreditCardResponseSchema)
async def update_credit_card(
    card_id: UUID,
    data: CreditCardUpdateSchema,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    statement = select(CreditCard).where(CreditCard.id == card_id, CreditCard.user_id == current_user.id, CreditCard.deleted_at == None)
    result = await session.exec(statement)
    card = result.first()
    if not card:
        raise HTTPException(status_code=404, detail="Credit card not found")

    card.card_name = data.card_name
    card.billing_cycle_day = data.billing_cycle_day
    card.due_day = data.due_day
    card.credit_limit = data.credit_limit
    card.current_balance = data.current_balance
    card.updated_at = datetime.utcnow()

    session.add(card)
    await session.commit()
    await session.refresh(card)
    return card

@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_credit_card(
    card_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    statement = select(CreditCard).where(CreditCard.id == card_id, CreditCard.user_id == current_user.id, CreditCard.deleted_at == None)
    result = await session.exec(statement)
    card = result.first()
    if not card:
        raise HTTPException(status_code=404, detail="Credit card not found")

    card.deleted_at = datetime.utcnow()
    card.updated_at = card.deleted_at
    session.add(card)
    await session.commit()
    return

@router.post("/{card_id}/pay", response_model=CreditCardResponseSchema)
async def pay_credit_card(
    card_id: UUID,
    payment: CardPaymentSchema,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    # Fetch credit card
    card_stmt = select(CreditCard).where(CreditCard.id == card_id, CreditCard.user_id == current_user.id, CreditCard.deleted_at == None)
    card_result = await session.exec(card_stmt)
    card = card_result.first()
    if not card:
        raise HTTPException(status_code=404, detail="Credit card not found")

    # Fetch wallet
    wallet_stmt = select(Wallet).where(Wallet.id == payment.wallet_id, Wallet.user_id == current_user.id, Wallet.deleted_at == None)
    wallet_result = await session.exec(wallet_stmt)
    wallet = wallet_result.first()
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")

    if payment.amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be positive")

    if wallet.balance < payment.amount:
        raise HTTPException(status_code=400, detail="Insufficient wallet balance")

    # Deduct from wallet, subtract from card outstanding balance
    wallet.balance -= payment.amount
    card.current_balance -= payment.amount
    if card.current_balance < 0:
        card.current_balance = Decimal("0.00") # Cannot have negative credit card debt balance

    now = datetime.utcnow()
    wallet.updated_at = now
    card.updated_at = now

    # Create audit transaction
    transaction = Transaction(
        user_id=current_user.id,
        tx_type="EXPENSE",
        description=f"จ่ายยอดบัตรเครดิต {card.card_name}",
        category="BILL",
        amount=payment.amount,
        wallet_id=wallet.id,
        created_at=now,
        updated_at=now
    )

    session.add(wallet)
    session.add(card)
    session.add(transaction)
    await session.commit()
    await session.refresh(card)
    return card
