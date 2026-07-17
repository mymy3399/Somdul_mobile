from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..config import settings
from ..database import get_db
from ..models import PushSubscription, User
from ..push_service import check_and_notify_due_bills, check_and_notify_due_loans, send_push_to_user
from ..schemas import PushSubscriptionCreate

router = APIRouter(prefix="/push", tags=["push"])


@router.get("/vapid-public-key")
async def vapid_public_key():
    return {"key": settings.VAPID_PUBLIC_KEY}


@router.post("/subscribe")
async def subscribe(
    payload: PushSubscriptionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(PushSubscription).where(PushSubscription.endpoint == payload.endpoint)
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        existing.user_id = user.id
        existing.p256dh = payload.keys.p256dh
        existing.auth = payload.keys.auth
    else:
        db.add(
            PushSubscription(
                user_id=user.id,
                endpoint=payload.endpoint,
                p256dh=payload.keys.p256dh,
                auth=payload.keys.auth,
            )
        )
    await db.commit()
    return {"ok": True}


@router.post("/unsubscribe")
async def unsubscribe(
    payload: dict, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    endpoint = payload.get("endpoint")
    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.endpoint == endpoint, PushSubscription.user_id == user.id
        )
    )
    sub = result.scalar_one_or_none()
    if sub is not None:
        await db.delete(sub)
        await db.commit()
    return {"ok": True}


@router.post("/test")
async def send_test_push(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await send_push_to_user(
        db, user.id, title="เงินทอง", body="ทดสอบการแจ้งเตือน — ระบบพร้อมใช้งานแล้ว 🎉"
    )
    return {"ok": True}


@router.post("/check-now")
async def trigger_due_check(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Manually trigger the daily due-bill/loan reminder sweep (normally runs on a schedule)."""
    sent_bills = await check_and_notify_due_bills(db)
    sent_loans = await check_and_notify_due_loans(db)
    return {"sent": sent_bills + sent_loans, "sent_bills": sent_bills, "sent_loans": sent_loans}
