from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..database import get_db
from ..models import Budget, Transaction, User
from ..schemas import BudgetCreate, BudgetOut

router = APIRouter(prefix="/budgets", tags=["budgets"])


async def _spent_this_month(db: AsyncSession, user_id: int, category: str) -> float:
    period = date.today().strftime("%Y-%m")
    result = await db.execute(
        select(func.coalesce(func.sum(Transaction.amount), 0.0)).where(
            Transaction.user_id == user_id,
            Transaction.category == category,
            Transaction.type == "expense",
            func.strftime("%Y-%m", Transaction.txn_date) == period,
        )
    )
    return result.scalar_one()


@router.get("", response_model=list[BudgetOut])
async def list_budgets(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(Budget).where(Budget.user_id == user.id).order_by(Budget.category))
    budgets = result.scalars().all()
    out = []
    for b in budgets:
        spent = await _spent_this_month(db, user.id, b.category)
        item = BudgetOut.model_validate(b)
        item.spent = spent
        out.append(item)
    return out


@router.post("", response_model=BudgetOut)
async def create_budget(
    payload: BudgetCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    existing = await db.execute(
        select(Budget).where(Budget.user_id == user.id, Budget.category == payload.category)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="มีงบประมาณของหมวดหมู่นี้อยู่แล้ว")
    budget = Budget(user_id=user.id, **payload.model_dump())
    db.add(budget)
    await db.commit()
    await db.refresh(budget)
    item = BudgetOut.model_validate(budget)
    item.spent = await _spent_this_month(db, user.id, budget.category)
    return item


async def _get_owned_budget(budget_id: int, db: AsyncSession, user: User) -> Budget:
    result = await db.execute(select(Budget).where(Budget.id == budget_id, Budget.user_id == user.id))
    budget = result.scalar_one_or_none()
    if budget is None:
        raise HTTPException(status_code=404, detail="Budget not found")
    return budget


@router.put("/{budget_id}", response_model=BudgetOut)
async def update_budget(
    budget_id: int,
    payload: BudgetCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    budget = await _get_owned_budget(budget_id, db, user)
    budget.category = payload.category
    budget.monthly_limit = payload.monthly_limit
    await db.commit()
    await db.refresh(budget)
    item = BudgetOut.model_validate(budget)
    item.spent = await _spent_this_month(db, user.id, budget.category)
    return item


@router.delete("/{budget_id}")
async def delete_budget(
    budget_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    budget = await _get_owned_budget(budget_id, db, user)
    await db.delete(budget)
    await db.commit()
    return {"ok": True}
