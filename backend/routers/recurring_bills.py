from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..database import get_db
from ..models import RecurringBill, RecurringBillInstance, Transaction, User
from ..recurring_utils import due_date_for
from ..schemas import (
    RecurringBillCreate,
    RecurringBillInstanceOut,
    RecurringBillOut,
    RecurringBillUpdate,
)

router = APIRouter(prefix="/recurring-bills", tags=["recurring-bills"])


@router.get("", response_model=list[RecurringBillOut])
async def list_bills(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(
        select(RecurringBill).where(RecurringBill.user_id == user.id).order_by(RecurringBill.due_day)
    )
    return result.scalars().all()


@router.post("", response_model=RecurringBillOut)
async def create_bill(
    payload: RecurringBillCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    if not (1 <= payload.due_day <= 31):
        raise HTTPException(status_code=400, detail="due_day must be between 1 and 31")
    bill = RecurringBill(user_id=user.id, **payload.model_dump())
    db.add(bill)
    await db.commit()
    await db.refresh(bill)
    return bill


async def _get_owned_bill(bill_id: int, db: AsyncSession, user: User) -> RecurringBill:
    result = await db.execute(
        select(RecurringBill).where(RecurringBill.id == bill_id, RecurringBill.user_id == user.id)
    )
    bill = result.scalar_one_or_none()
    if bill is None:
        raise HTTPException(status_code=404, detail="Recurring bill not found")
    return bill


@router.put("/{bill_id}", response_model=RecurringBillOut)
async def update_bill(
    bill_id: int,
    payload: RecurringBillUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    bill = await _get_owned_bill(bill_id, db, user)
    for field, value in payload.model_dump().items():
        setattr(bill, field, value)
    await db.commit()
    await db.refresh(bill)
    return bill


@router.delete("/{bill_id}")
async def delete_bill(
    bill_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    bill = await _get_owned_bill(bill_id, db, user)
    await db.delete(bill)
    await db.commit()
    return {"ok": True}


@router.post("/generate", response_model=list[RecurringBillInstanceOut])
async def generate_due_instances(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Create pending instances for active bills whose due date has arrived this period."""
    today = date.today()
    period = today.strftime("%Y-%m")

    result = await db.execute(
        select(RecurringBill).where(RecurringBill.user_id == user.id, RecurringBill.is_active.is_(True))
    )
    bills = result.scalars().all()

    created: list[RecurringBillInstance] = []
    for bill in bills:
        due_date = due_date_for(today.year, today.month, bill.due_day)
        if due_date > today:
            continue
        existing = await db.execute(
            select(RecurringBillInstance).where(
                RecurringBillInstance.recurring_bill_id == bill.id,
                RecurringBillInstance.period == period,
            )
        )
        if existing.scalar_one_or_none() is not None:
            continue
        instance = RecurringBillInstance(
            recurring_bill_id=bill.id,
            period=period,
            due_date=due_date,
            amount=bill.amount,
            status="pending",
        )
        db.add(instance)
        created.append(instance)

    if created:
        await db.commit()
        for inst in created:
            await db.refresh(inst)

    return [
        RecurringBillInstanceOut(
            **RecurringBillInstanceOut.model_validate(inst).model_dump(exclude={"bill_name"}),
            bill_name=next(b.name for b in bills if b.id == inst.recurring_bill_id),
        )
        for inst in created
    ]


@router.get("/instances", response_model=list[RecurringBillInstanceOut])
async def list_instances(
    status: str | None = None, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    stmt = (
        select(RecurringBillInstance, RecurringBill.name)
        .join(RecurringBill, RecurringBillInstance.recurring_bill_id == RecurringBill.id)
        .where(RecurringBill.user_id == user.id)
        .order_by(RecurringBillInstance.due_date.desc())
    )
    if status:
        stmt = stmt.where(RecurringBillInstance.status == status)
    result = await db.execute(stmt)
    rows = result.all()
    return [
        RecurringBillInstanceOut(
            **RecurringBillInstanceOut.model_validate(inst).model_dump(exclude={"bill_name"}),
            bill_name=name,
        )
        for inst, name in rows
    ]


async def _get_owned_instance(instance_id: int, db: AsyncSession, user: User) -> RecurringBillInstance:
    result = await db.execute(
        select(RecurringBillInstance, RecurringBill)
        .join(RecurringBill, RecurringBillInstance.recurring_bill_id == RecurringBill.id)
        .where(RecurringBillInstance.id == instance_id, RecurringBill.user_id == user.id)
    )
    row = result.first()
    if row is None:
        raise HTTPException(status_code=404, detail="Bill instance not found")
    return row[0], row[1]


@router.post("/instances/{instance_id}/pay", response_model=RecurringBillInstanceOut)
async def pay_instance(
    instance_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    instance, bill = await _get_owned_instance(instance_id, db, user)
    if instance.status != "pending":
        raise HTTPException(status_code=400, detail="Instance is not pending")

    txn = Transaction(
        user_id=user.id,
        type="expense",
        amount=instance.amount,
        category=bill.category,
        payment_method=bill.payment_method,
        credit_card_id=bill.credit_card_id,
        description=f"{bill.name} ({instance.period})",
        txn_date=date.today(),
        source="recurring",
        recurring_instance_id=instance.id,
    )
    db.add(txn)
    await db.flush()

    instance.status = "paid"
    instance.paid_date = date.today()
    instance.transaction_id = txn.id
    await db.commit()
    await db.refresh(instance)
    return RecurringBillInstanceOut(
        **RecurringBillInstanceOut.model_validate(instance).model_dump(exclude={"bill_name"}),
        bill_name=bill.name,
    )


@router.post("/instances/{instance_id}/skip", response_model=RecurringBillInstanceOut)
async def skip_instance(
    instance_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    instance, bill = await _get_owned_instance(instance_id, db, user)
    if instance.status != "pending":
        raise HTTPException(status_code=400, detail="Instance is not pending")
    instance.status = "skipped"
    await db.commit()
    await db.refresh(instance)
    return RecurringBillInstanceOut(
        **RecurringBillInstanceOut.model_validate(instance).model_dump(exclude={"bill_name"}),
        bill_name=bill.name,
    )
