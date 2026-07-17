from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..database import get_db
from ..models import CreditCard, Transaction, User
from ..schemas import CreditCardCreate, CreditCardOut, CreditCardUpdate

router = APIRouter(prefix="/credit-cards", tags=["credit-cards"])


@router.get("", response_model=list[CreditCardOut])
async def list_cards(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(
        select(CreditCard).where(CreditCard.user_id == user.id).order_by(CreditCard.created_at)
    )
    return result.scalars().all()


@router.post("", response_model=CreditCardOut)
async def create_card(
    payload: CreditCardCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    card = CreditCard(user_id=user.id, **payload.model_dump())
    db.add(card)
    await db.commit()
    await db.refresh(card)
    return card


async def _get_owned_card(card_id: int, db: AsyncSession, user: User) -> CreditCard:
    result = await db.execute(
        select(CreditCard).where(CreditCard.id == card_id, CreditCard.user_id == user.id)
    )
    card = result.scalar_one_or_none()
    if card is None:
        raise HTTPException(status_code=404, detail="Credit card not found")
    return card


@router.put("/{card_id}", response_model=CreditCardOut)
async def update_card(
    card_id: int,
    payload: CreditCardUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = await _get_owned_card(card_id, db, user)
    for field, value in payload.model_dump().items():
        setattr(card, field, value)
    await db.commit()
    await db.refresh(card)
    return card


@router.delete("/{card_id}")
async def delete_card(
    card_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    card = await _get_owned_card(card_id, db, user)
    await db.delete(card)
    await db.commit()
    return {"ok": True}


@router.get("/{card_id}/summary")
async def card_summary(
    card_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    card = await _get_owned_card(card_id, db, user)

    today = date.today()
    cycle_start_day = card.statement_day or 1
    if today.day >= cycle_start_day:
        cycle_start = date(today.year, today.month, cycle_start_day)
    else:
        prev_month = today.month - 1 or 12
        prev_year = today.year - 1 if today.month == 1 else today.year
        cycle_start = date(prev_year, prev_month, cycle_start_day)

    result = await db.execute(
        select(func.coalesce(func.sum(Transaction.amount), 0.0)).where(
            Transaction.credit_card_id == card_id,
            Transaction.type == "expense",
            Transaction.txn_date >= cycle_start,
        )
    )
    cycle_spend = result.scalar_one()
    return {
        "card_id": card_id,
        "cycle_start": cycle_start.isoformat(),
        "cycle_spend": cycle_spend,
        "credit_limit": card.credit_limit,
        "available": (card.credit_limit - cycle_spend) if card.credit_limit else None,
    }
