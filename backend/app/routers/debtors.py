import math
from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from pydantic import BaseModel
from decimal import Decimal
from datetime import date, datetime

from app.database import get_session
from app.models import Debtor, Debt, DebtHistory, CreditCard, Wallet, Transaction, User
from app.security import get_current_user

router = APIRouter(prefix="/debtors", tags=["Debtors & Debts"])

VALID_INTEREST_TYPES = (None, "FLAT", "PERCENT")

# ----------------------------------------------------
# SCHEMAS
# ----------------------------------------------------
class DebtResponseSchema(BaseModel):
    id: UUID
    debtor_id: UUID
    debt_type: str
    credit_card_id: Optional[UUID] = None
    total_amount: Decimal
    remaining_amount: Decimal
    total_installments: int
    remaining_installments: int
    due_day: int
    due_date: Optional[date] = None
    interest_type: Optional[str] = None
    interest_value: Optional[Decimal] = None
    memo: Optional[str] = None
    status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class DebtorResponseSchema(BaseModel):
    id: UUID
    debtor_name: str
    contact_info: Optional[str] = None
    debts: List[DebtResponseSchema] = []

    class Config:
        from_attributes = True

class DebtCreateSchema(BaseModel):
    debtor_id: Optional[UUID] = None  # If null, use debtor_name to find/create
    debtor_name: Optional[str] = None # Used to create a new debtor if debtor_id is null
    contact_info: Optional[str] = None # Used if creating new debtor

    debt_type: str # CASH_LOAN, CREDIT_CARD_INSTALLMENT
    credit_card_id: Optional[UUID] = None
    wallet_id: Optional[UUID] = None # Optional wallet to deduct cash from for CASH_LOAN

    total_amount: Decimal
    total_installments: int = 1
    due_day: int = 1
    due_date: Optional[date] = None # specific calendar date, for one-off (non-monthly) debts
    interest_type: Optional[str] = None
    interest_value: Optional[Decimal] = None
    memo: Optional[str] = None

class DebtUpdateSchema(BaseModel):
    due_day: Optional[int] = None
    due_date: Optional[date] = None
    interest_type: Optional[str] = None
    interest_value: Optional[Decimal] = None
    memo: Optional[str] = None

class DebtHistoryResponseSchema(BaseModel):
    id: UUID
    summary: str
    changed_at: datetime

    class Config:
        from_attributes = True

class RepaymentSchema(BaseModel):
    wallet_id: UUID
    amount: Decimal

# ----------------------------------------------------
# ROUTERS
# ----------------------------------------------------

@router.get("", response_model=List[DebtorResponseSchema])
async def list_debtors(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    # Fetch all debtors belonging to current user
    stmt = select(Debtor).where(Debtor.user_id == current_user.id, Debtor.deleted_at == None)
    debtors_result = await session.exec(stmt)
    debtors = debtors_result.all()

    # Pre-populate nested debts list
    # SQLModel automatically maps relationships if queried correctly, but we'll build the response structure
    response = []
    for debtor in debtors:
        debt_stmt = select(Debt).where(Debt.debtor_id == debtor.id, Debt.deleted_at == None).order_by(Debt.created_at.desc())
        debts_result = await session.exec(debt_stmt)
        debts = debts_result.all()

        debtor_data = DebtorResponseSchema(
            id=debtor.id,
            debtor_name=debtor.debtor_name,
            contact_info=debtor.contact_info,
            debts=[DebtResponseSchema.from_orm(d) for d in debts]
        )
        response.append(debtor_data)

    return response

@router.post("", response_model=DebtorResponseSchema, status_code=status.HTTP_201_CREATED)
async def create_debtor(
    debtor_name: str,
    contact_info: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    # Check if debtor already exists
    stmt = select(Debtor).where(Debtor.debtor_name == debtor_name, Debtor.user_id == current_user.id, Debtor.deleted_at == None)
    result = await session.exec(stmt)
    existing = result.first()
    if existing:
        raise HTTPException(status_code=400, detail="Debtor with this name already exists")

    debtor = Debtor(
        user_id=current_user.id,
        debtor_name=debtor_name,
        contact_info=contact_info
    )
    session.add(debtor)
    await session.commit()
    await session.refresh(debtor)
    return DebtorResponseSchema(id=debtor.id, debtor_name=debtor.debtor_name, contact_info=debtor.contact_info, debts=[])

@router.post("/debts", response_model=DebtResponseSchema, status_code=status.HTTP_201_CREATED)
async def create_debt(
    data: DebtCreateSchema,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    # 1. Resolve Debtor
    debtor = None
    if data.debtor_id:
        debtor_stmt = select(Debtor).where(Debtor.id == data.debtor_id, Debtor.user_id == current_user.id, Debtor.deleted_at == None)
        debtor_result = await session.exec(debtor_stmt)
        debtor = debtor_result.first()
        if not debtor:
            raise HTTPException(status_code=404, detail="Selected debtor not found")
    elif data.debtor_name:
        # Find by name or create
        debtor_stmt = select(Debtor).where(Debtor.debtor_name == data.debtor_name, Debtor.user_id == current_user.id, Debtor.deleted_at == None)
        debtor_result = await session.exec(debtor_stmt)
        debtor = debtor_result.first()
        if not debtor:
            debtor = Debtor(
                user_id=current_user.id,
                debtor_name=data.debtor_name,
                contact_info=data.contact_info
            )
            session.add(debtor)
            await session.flush() # populate debtor.id
    else:
        raise HTTPException(status_code=400, detail="Either debtor_id or debtor_name must be provided")

    # 2. Perform validations & balances changes depending on debt type
    card = None
    wallet = None

    if data.debt_type == "CREDIT_CARD_INSTALLMENT":
        if not data.credit_card_id:
            raise HTTPException(status_code=400, detail="credit_card_id is required for CREDIT_CARD_INSTALLMENT")

        card_stmt = select(CreditCard).where(CreditCard.id == data.credit_card_id, CreditCard.user_id == current_user.id, CreditCard.deleted_at == None)
        card_result = await session.exec(card_stmt)
        card = card_result.first()
        if not card:
            raise HTTPException(status_code=404, detail="Selected credit card not found")

        # Check credit limit
        if card.current_balance + data.total_amount > card.credit_limit:
            # We allow going over credit limit in simulation but warn / throw error depending on strictness.
            # Let's permit it but update card balance.
            pass

        # Increase card balance (more outstanding debt to bank)
        card.current_balance += data.total_amount
        card.updated_at = datetime.utcnow()
        session.add(card)

        # Create credit card transaction in history
        card_tx = Transaction(
            user_id=current_user.id,
            tx_type="EXPENSE",
            description=f"รูดแทน: {debtor.debtor_name} ({data.memo or 'ผ่อนแทน'})",
            category="DEBT",
            amount=data.total_amount,
            credit_card_id=card.id,
            created_at=datetime.utcnow()
        )
        session.add(card_tx)

    elif data.debt_type in ["CASH_LOAN", "INSTALLMENT", "SHARED_SUBSCRIPTION"]:
        # Deduct from user's wallet if wallet_id is provided
        if data.wallet_id:
            wallet_stmt = select(Wallet).where(Wallet.id == data.wallet_id, Wallet.user_id == current_user.id, Wallet.deleted_at == None)
            wallet_result = await session.exec(wallet_stmt)
            wallet = wallet_result.first()
            if not wallet:
                raise HTTPException(status_code=404, detail="Selected wallet not found")

            if wallet.balance < data.total_amount:
                raise HTTPException(status_code=400, detail="Insufficient wallet balance to lend cash")

            wallet.balance -= data.total_amount
            wallet.updated_at = datetime.utcnow()
            session.add(wallet)

            # Create cash transaction in history
            wallet_tx = Transaction(
                user_id=current_user.id,
                tx_type="EXPENSE",
                description=f"ให้ยืมเงินสด: {debtor.debtor_name} ({data.memo or 'ยืมเงิน'})",
                category="DEBT",
                amount=data.total_amount,
                wallet_id=wallet.id,
                created_at=datetime.utcnow()
            )
            session.add(wallet_tx)
    else:
        raise HTTPException(status_code=400, detail="Invalid debt_type")

    if data.interest_type not in VALID_INTEREST_TYPES:
        raise HTTPException(status_code=400, detail="interest_type must be FLAT, PERCENT, or omitted")

    # 3. Create Debt
    new_debt = Debt(
        debtor_id=debtor.id,
        debt_type=data.debt_type,
        credit_card_id=data.credit_card_id,
        total_amount=data.total_amount,
        remaining_amount=data.total_amount,
        total_installments=data.total_installments,
        remaining_installments=data.total_installments,
        due_day=data.due_day,
        due_date=data.due_date,
        interest_type=data.interest_type,
        interest_value=data.interest_value,
        memo=data.memo,
        status="UNPAID",
        created_at=datetime.utcnow()
    )

    session.add(new_debt)
    await session.commit()
    await session.refresh(new_debt)
    return new_debt

@router.post("/debts/{debt_id}/repay", response_model=DebtResponseSchema)
async def repay_debt(
    debt_id: UUID,
    repayment: RepaymentSchema,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    # Fetch Debt
    debt_stmt = select(Debt).where(Debt.id == debt_id, Debt.deleted_at == None)
    debt_result = await session.exec(debt_stmt)
    debt = debt_result.first()
    if not debt:
        raise HTTPException(status_code=404, detail="Debt record not found")

    # Fetch Debtor to check owner
    debtor_stmt = select(Debtor).where(Debtor.id == debt.debtor_id, Debtor.user_id == current_user.id, Debtor.deleted_at == None)
    debtor_result = await session.exec(debtor_stmt)
    debtor = debtor_result.first()
    if not debtor:
        raise HTTPException(status_code=403, detail="Not authorized to access this debt")

    if debt.status == "PAID" or debt.remaining_amount <= 0:
        raise HTTPException(status_code=400, detail="Debt is already fully paid")

    # Fetch Target Wallet (receives the money)
    wallet_stmt = select(Wallet).where(Wallet.id == repayment.wallet_id, Wallet.user_id == current_user.id, Wallet.deleted_at == None)
    wallet_result = await session.exec(wallet_stmt)
    wallet = wallet_result.first()
    if not wallet:
        raise HTTPException(status_code=404, detail="Selected wallet not found")

    if repayment.amount <= 0:
        raise HTTPException(status_code=400, detail="Repayment amount must be positive")

    if repayment.amount > debt.remaining_amount:
        raise HTTPException(status_code=400, detail="Repayment amount exceeds remaining debt balance")

    # Apply money to wallet
    wallet.balance += repayment.amount
    wallet.updated_at = datetime.utcnow()
    session.add(wallet)

    # Deduct debt remaining amount
    debt.remaining_amount -= repayment.amount

    # Derive remaining installments from remaining_amount so the two never
    # drift apart, regardless of whether the payment matches a full
    # installment (previously this always decremented by 1 per payment,
    # which could mark a debt PAID while remaining_amount was still > 0).
    if debt.total_installments > 1:
        installment_val = debt.total_amount / debt.total_installments
        debt.remaining_installments = math.ceil(debt.remaining_amount / installment_val) if debt.remaining_amount > 0 else 0

    # Update Status
    if debt.remaining_amount <= 0:
        debt.remaining_amount = Decimal("0.00")
        debt.remaining_installments = 0
        debt.status = "PAID"
    else:
        debt.status = "PARTIALLY_PAID"

    debt.updated_at = datetime.utcnow()
    session.add(debt)

    # Create audit transaction in ledger
    repay_tx = Transaction(
        user_id=current_user.id,
        tx_type="INCOME",
        description=f"รับชำระคืนจาก {debtor.debtor_name} ({debt.memo or 'คืนเงิน'})",
        category="REFUND",
        amount=repayment.amount,
        wallet_id=wallet.id,
        created_at=datetime.utcnow()
    )
    session.add(repay_tx)

    await session.commit()
    await session.refresh(debt)
    return debt

@router.delete("/debts/{debt_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_debt(
    debt_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    debt_stmt = select(Debt).join(Debtor).where(Debt.id == debt_id, Debtor.user_id == current_user.id, Debt.deleted_at == None)
    result = await session.exec(debt_stmt)
    debt = result.first()
    if not debt:
        raise HTTPException(status_code=404, detail="Debt not found")
    debt.deleted_at = datetime.utcnow()
    debt.updated_at = debt.deleted_at
    session.add(debt)
    await session.commit()

@router.post("/debts/{debt_id}/reset-cycle")
async def reset_debt_cycle(
    debt_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    debt_stmt = select(Debt).join(Debtor).where(Debt.id == debt_id, Debtor.user_id == current_user.id, Debt.deleted_at == None)
    result = await session.exec(debt_stmt)
    debt = result.first()
    if not debt:
        raise HTTPException(status_code=404, detail="Debt record not found")

    if debt.status == "PAID":
        debt.status = "UNPAID"
        debt.remaining_amount = debt.total_amount
    else:
        debt.remaining_amount += debt.total_amount

    debt.updated_at = datetime.utcnow()
    session.add(debt)
    await session.commit()
    await session.refresh(debt)
    return debt

def _format_thai_date(d: date) -> str:
    return d.strftime("%d/%m/%Y")

INTEREST_TYPE_LABELS = {"FLAT": "บาท", "PERCENT": "%"}

@router.put("/debts/{debt_id}", response_model=DebtResponseSchema)
async def update_debt(
    debt_id: UUID,
    data: DebtUpdateSchema,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    """Edit a debt's due date/day, interest terms, or memo — every actual
    change is appended to DebtHistory as a human-readable Thai summary so a
    reschedule or interest adjustment is auditable later. Never touches
    remaining_amount/status — repayments are still the only thing that moves
    money (see repay_debt)."""
    debt_stmt = select(Debt).join(Debtor).where(Debt.id == debt_id, Debtor.user_id == current_user.id, Debt.deleted_at == None)
    result = await session.exec(debt_stmt)
    debt = result.first()
    if not debt:
        raise HTTPException(status_code=404, detail="Debt record not found")

    if data.interest_type not in VALID_INTEREST_TYPES:
        raise HTTPException(status_code=400, detail="interest_type must be FLAT, PERCENT, or omitted")

    changes: list[str] = []

    if data.due_date is not None and data.due_date != debt.due_date:
        old_label = _format_thai_date(debt.due_date) if debt.due_date else f"วันที่ {debt.due_day} ของทุกเดือน"
        changes.append(f"เลื่อนกำหนดชำระจาก {old_label} เป็น {_format_thai_date(data.due_date)}")
        debt.due_date = data.due_date

    if data.due_day is not None and data.due_day != debt.due_day:
        changes.append(f"เปลี่ยนวันกำหนดชำระรายเดือนจากวันที่ {debt.due_day} เป็นวันที่ {data.due_day}")
        debt.due_day = data.due_day

    new_interest_type = data.interest_type if "interest_type" in data.model_fields_set else debt.interest_type
    new_interest_value = data.interest_value if "interest_value" in data.model_fields_set else debt.interest_value
    if new_interest_type != debt.interest_type or new_interest_value != debt.interest_value:
        old_label = f"{debt.interest_value}{INTEREST_TYPE_LABELS.get(debt.interest_type, '')}" if debt.interest_type else "ไม่กำหนด"
        new_label = f"{new_interest_value}{INTEREST_TYPE_LABELS.get(new_interest_type, '')}" if new_interest_type else "ไม่กำหนด"
        changes.append(f"ปรับดอกเบี้ยจาก {old_label} เป็น {new_label}")
        debt.interest_type = new_interest_type
        debt.interest_value = new_interest_value

    if data.memo is not None and data.memo != debt.memo:
        changes.append(f"แก้ไขหมายเหตุจาก \"{debt.memo or '-'}\" เป็น \"{data.memo}\"")
        debt.memo = data.memo

    if changes:
        debt.updated_at = datetime.utcnow()
        session.add(debt)
        for change in changes:
            session.add(DebtHistory(debt_id=debt.id, summary=change, changed_at=debt.updated_at))
        await session.commit()
        await session.refresh(debt)

    return debt

@router.get("/debts/{debt_id}/history", response_model=List[DebtHistoryResponseSchema])
async def list_debt_history(
    debt_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    debt_stmt = select(Debt).join(Debtor).where(Debt.id == debt_id, Debtor.user_id == current_user.id, Debt.deleted_at == None)
    result = await session.exec(debt_stmt)
    debt = result.first()
    if not debt:
        raise HTTPException(status_code=404, detail="Debt record not found")

    stmt = select(DebtHistory).where(DebtHistory.debt_id == debt_id).order_by(DebtHistory.changed_at.desc())
    history_result = await session.exec(stmt)
    return history_result.all()
