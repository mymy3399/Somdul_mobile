import csv
import io
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..database import get_db
from ..models import Transaction, User
from ..schemas import TransactionCreate, TransactionOut, TransactionSummary, TrendPoint

router = APIRouter(prefix="/transactions", tags=["transactions"])

PAYMENT_METHOD_LABEL_TH = {"cash": "เงินสด", "transfer": "โอนเงิน", "credit_card": "บัตรเครดิต"}


def _apply_filters(
    stmt,
    user: User,
    type: str | None,
    category: str | None,
    date_from: date | None,
    date_to: date | None,
    q: str | None,
):
    stmt = stmt.where(Transaction.user_id == user.id)
    if type:
        stmt = stmt.where(Transaction.type == type)
    if category:
        stmt = stmt.where(Transaction.category == category)
    if date_from:
        stmt = stmt.where(Transaction.txn_date >= date_from)
    if date_to:
        stmt = stmt.where(Transaction.txn_date <= date_to)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Transaction.description.ilike(like), Transaction.category.ilike(like)))
    return stmt


@router.get("", response_model=list[TransactionOut])
async def list_transactions(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    type: str | None = None,
    category: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
    limit: int = Query(default=200, le=1000),
):
    stmt = _apply_filters(select(Transaction), user, type, category, date_from, date_to, q)
    stmt = stmt.order_by(Transaction.txn_date.desc(), Transaction.id.desc()).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=TransactionOut)
async def create_transaction(
    payload: TransactionCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    if payload.type not in ("income", "expense"):
        raise HTTPException(status_code=400, detail="type must be 'income' or 'expense'")
    txn = Transaction(user_id=user.id, **payload.model_dump())
    db.add(txn)
    await db.commit()
    await db.refresh(txn)
    return txn


async def _get_owned_txn(txn_id: int, db: AsyncSession, user: User) -> Transaction:
    result = await db.execute(
        select(Transaction).where(Transaction.id == txn_id, Transaction.user_id == user.id)
    )
    txn = result.scalar_one_or_none()
    if txn is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return txn


@router.put("/{txn_id}", response_model=TransactionOut)
async def update_transaction(
    txn_id: int,
    payload: TransactionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    txn = await _get_owned_txn(txn_id, db, user)
    for field, value in payload.model_dump().items():
        setattr(txn, field, value)
    await db.commit()
    await db.refresh(txn)
    return txn


@router.delete("/{txn_id}")
async def delete_transaction(
    txn_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    txn = await _get_owned_txn(txn_id, db, user)
    await db.delete(txn)
    await db.commit()
    return {"ok": True}


@router.get("/summary", response_model=TransactionSummary)
async def summary(
    period: str = Query(default_factory=lambda: date.today().strftime("%Y-%m")),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    year, month = (int(p) for p in period.split("-"))
    result = await db.execute(
        select(Transaction).where(
            Transaction.user_id == user.id,
            func.strftime("%Y-%m", Transaction.txn_date) == period,
        )
    )
    txns = result.scalars().all()
    total_income = sum(t.amount for t in txns if t.type == "income")
    total_expense = sum(t.amount for t in txns if t.type == "expense")
    by_category: dict[str, float] = {}
    for t in txns:
        if t.type == "expense":
            by_category[t.category] = by_category.get(t.category, 0.0) + t.amount
    return TransactionSummary(
        period=period,
        total_income=total_income,
        total_expense=total_expense,
        balance=total_income - total_expense,
        by_category=by_category,
    )


@router.get("/trend", response_model=list[TrendPoint])
async def trend(
    months: int = Query(default=6, ge=1, le=24),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    today = date.today()
    periods = []
    y, m = today.year, today.month
    for _ in range(months):
        periods.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    periods.reverse()

    result = await db.execute(
        select(
            func.strftime("%Y-%m", Transaction.txn_date).label("period"),
            Transaction.type,
            func.sum(Transaction.amount),
        )
        .where(Transaction.user_id == user.id, func.strftime("%Y-%m", Transaction.txn_date).in_(periods))
        .group_by("period", Transaction.type)
    )
    totals: dict[str, dict[str, float]] = {p: {"income": 0.0, "expense": 0.0} for p in periods}
    for period, txn_type, amount in result.all():
        if period in totals:
            totals[period][txn_type] = amount

    return [
        TrendPoint(period=p, total_income=totals[p]["income"], total_expense=totals[p]["expense"])
        for p in periods
    ]


@router.get("/export/csv")
async def export_csv(
    type: str | None = None,
    category: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = _apply_filters(select(Transaction), user, type, category, date_from, date_to, q)
    stmt = stmt.order_by(Transaction.txn_date.desc(), Transaction.id.desc())
    result = await db.execute(stmt)
    txns = result.scalars().all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["วันที่", "ประเภท", "หมวดหมู่", "รายละเอียด", "ช่องทาง", "จำนวนเงิน", "ที่มา"])
    for t in txns:
        writer.writerow([
            t.txn_date.isoformat(),
            "รายรับ" if t.type == "income" else "รายจ่าย",
            t.category,
            t.description,
            PAYMENT_METHOD_LABEL_TH.get(t.payment_method, t.payment_method),
            f"{t.amount:.2f}",
            t.source,
        ])
    buffer.seek(0)

    filename = f"transactions_{date.today().isoformat()}.csv"
    return StreamingResponse(
        iter(["﻿" + buffer.getvalue()]),  # BOM so Excel renders Thai text correctly
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
