from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
import json

from app.database import get_session
from app.models import (
    Wallet,
    CreditCard,
    Debtor,
    Debt,
    Transaction,
    RecurringPayment,
    Budget,
    Category,
    QuickTemplate,
    User,
)
from app.security import get_current_user

router = APIRouter(prefix="/export", tags=["Export"])


def _decimal_default(obj):
    # json.dumps doesn't know how to serialize Decimal/UUID/datetime/date on
    # its own — SQLModel objects carry all four across these tables.
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    return str(obj)


@router.get("/full")
async def export_full_backup(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    """A full JSON dump of everything this user owns — wallets, cards,
    debtors/debts, transactions, recurring payments, budgets, categories,
    quick templates — for backup/migration purposes. Soft-deleted rows are
    excluded, same as every other list endpoint. Not meant to be re-imported
    automatically (there's no /import endpoint); it's a human-readable
    snapshot to keep somewhere safe."""

    async def rows(model, *extra_where):
        stmt = select(model).where(model.user_id == current_user.id, model.deleted_at == None, *extra_where)
        result = await session.exec(stmt)
        return [r.model_dump(mode="json") for r in result.all()]

    debtors_result = await session.exec(
        select(Debtor).where(Debtor.user_id == current_user.id, Debtor.deleted_at == None)
    )
    debtors = debtors_result.all()
    debtors_payload = []
    for debtor in debtors:
        debts_result = await session.exec(
            select(Debt).where(Debt.debtor_id == debtor.id, Debt.deleted_at == None)
        )
        debtors_payload.append({
            **debtor.model_dump(mode="json"),
            "debts": [d.model_dump(mode="json") for d in debts_result.all()],
        })

    payload = {
        "exported_at": datetime.utcnow().isoformat(),
        "user": {"name": current_user.name, "email": current_user.email},
        "wallets": await rows(Wallet),
        "credit_cards": await rows(CreditCard),
        "debtors": debtors_payload,
        "transactions": await rows(Transaction),
        "recurring_payments": await rows(RecurringPayment),
        "budgets": await rows(Budget),
        "categories": await rows(Category),
        "quick_templates": await rows(QuickTemplate),
    }

    filename = f"somdul-backup-{datetime.utcnow().strftime('%Y%m%d')}.json"
    return StreamingResponse(
        iter([json.dumps(payload, ensure_ascii=False, indent=2, default=_decimal_default)]),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
