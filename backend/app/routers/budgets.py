from datetime import datetime
from decimal import Decimal
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import Session, select

from app.database import get_session
from app.models import Budget, Transaction, User
from app.security import get_current_user

router = APIRouter(prefix="/budgets", tags=["Budgets"])


class BudgetUpsertSchema(BaseModel):
    category: str
    monthly_limit: Decimal


class BudgetResponseSchema(BaseModel):
    id: UUID
    category: str
    monthly_limit: Decimal
    spent_this_month: Decimal

    class Config:
        from_attributes = True


def _spent_this_month(session: Session, user_id: UUID, category: str) -> Decimal:
    now = datetime.utcnow()
    month_start = datetime(now.year, now.month, 1)
    stmt = select(func.coalesce(func.sum(Transaction.amount), 0)).where(
        Transaction.user_id == user_id,
        Transaction.category == category,
        Transaction.tx_type == "EXPENSE",
        Transaction.created_at >= month_start,
    )
    return session.exec(stmt).one()


@router.get("", response_model=List[BudgetResponseSchema])
def list_budgets(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    stmt = select(Budget).where(Budget.user_id == current_user.id, Budget.deleted_at == None)
    budgets = session.exec(stmt).all()
    return [
        BudgetResponseSchema(
            id=b.id,
            category=b.category,
            monthly_limit=b.monthly_limit,
            spent_this_month=_spent_this_month(session, current_user.id, b.category),
        )
        for b in budgets
    ]


@router.post("", response_model=BudgetResponseSchema, status_code=status.HTTP_201_CREATED)
def upsert_budget(
    data: BudgetUpsertSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    category = data.category.upper()
    stmt = select(Budget).where(Budget.user_id == current_user.id, Budget.category == category, Budget.deleted_at == None)
    budget = session.exec(stmt).first()

    if budget:
        budget.monthly_limit = data.monthly_limit
        budget.updated_at = datetime.utcnow()
    else:
        budget = Budget(user_id=current_user.id, category=category, monthly_limit=data.monthly_limit)

    session.add(budget)
    session.commit()
    session.refresh(budget)

    return BudgetResponseSchema(
        id=budget.id,
        category=budget.category,
        monthly_limit=budget.monthly_limit,
        spent_this_month=_spent_this_month(session, current_user.id, budget.category),
    )


@router.delete("/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_budget(
    budget_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    stmt = select(Budget).where(Budget.id == budget_id, Budget.user_id == current_user.id, Budget.deleted_at == None)
    budget = session.exec(stmt).first()
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")

    budget.deleted_at = datetime.utcnow()
    budget.updated_at = budget.deleted_at
    session.add(budget)
    session.commit()
    return
