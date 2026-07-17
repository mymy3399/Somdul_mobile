import json
import logging
from datetime import date, timedelta

from pywebpush import WebPushException, webpush
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .models import Loan, LoanPayment, PushSubscription, RecurringBill, RecurringBillInstance
from .recurring_utils import due_date_for

logger = logging.getLogger(__name__)


async def send_push_to_user(db: AsyncSession, user_id: int, title: str, body: str, url: str = "/") -> None:
    result = await db.execute(select(PushSubscription).where(PushSubscription.user_id == user_id))
    subs = result.scalars().all()
    payload = json.dumps({"title": title, "body": body, "url": url})

    for sub in subs:
        subscription_info = {
            "endpoint": sub.endpoint,
            "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
        }
        try:
            webpush(
                subscription_info=subscription_info,
                data=payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_CLAIMS_EMAIL},
            )
        except WebPushException as exc:
            status_code = exc.response.status_code if exc.response is not None else None
            if status_code in (404, 410):
                # subscription expired or was revoked by the browser — clean it up
                await db.delete(sub)
                await db.commit()
            else:
                logger.warning("push send failed for user %s: %s", user_id, exc)


async def check_and_notify_due_bills(db: AsyncSession) -> int:
    """Send a reminder push for every active recurring bill due today or
    tomorrow that hasn't already been paid/skipped for the current period.
    Meant to be called once a day by the scheduler. Returns how many pushes
    were sent (for logging/testing)."""
    today = date.today()
    tomorrow = today + timedelta(days=1)
    period = today.strftime("%Y-%m")

    result = await db.execute(select(RecurringBill).where(RecurringBill.is_active.is_(True)))
    bills = result.scalars().all()

    sent = 0
    for bill in bills:
        due = due_date_for(today.year, today.month, bill.due_day)
        if due not in (today, tomorrow):
            continue

        existing = await db.execute(
            select(RecurringBillInstance).where(
                RecurringBillInstance.recurring_bill_id == bill.id,
                RecurringBillInstance.period == period,
                RecurringBillInstance.status != "pending",
            )
        )
        if existing.scalar_one_or_none() is not None:
            continue

        when = "วันนี้" if due == today else "พรุ่งนี้"
        await send_push_to_user(
            db,
            bill.user_id,
            title="รายจ่ายประจำใกล้ถึงกำหนด",
            body=f"{bill.name} ฿{bill.amount:,.2f} ครบกำหนดชำระ{when}",
            url="/",
        )
        sent += 1

    return sent


async def check_and_notify_due_loans(db: AsyncSession) -> int:
    """Send a reminder push for every active loan installment (monthly or
    product installment, with a due_day set) due today or tomorrow that
    hasn't already had a payment recorded for the current period. Meant to
    be called once a day by the scheduler, alongside check_and_notify_due_bills."""
    today = date.today()
    tomorrow = today + timedelta(days=1)
    period = today.strftime("%Y-%m")

    result = await db.execute(
        select(Loan).where(
            Loan.status == "active",
            Loan.repayment_type.in_(["monthly_installment", "product_installment"]),
            Loan.due_day.isnot(None),
        )
    )
    loans = result.scalars().all()

    sent = 0
    for loan in loans:
        due = due_date_for(today.year, today.month, loan.due_day)
        if due not in (today, tomorrow):
            continue

        existing_payment = await db.execute(
            select(LoanPayment).where(
                LoanPayment.loan_id == loan.id,
                func.strftime("%Y-%m", LoanPayment.payment_date) == period,
            )
        )
        if existing_payment.scalar_one_or_none() is not None:
            continue

        when = "วันนี้" if due == today else "พรุ่งนี้"
        amount = loan.installment_amount or loan.principal_amount
        await send_push_to_user(
            db,
            loan.user_id,
            title="ใกล้ถึงกำหนดรับชำระหนี้",
            body=f"{loan.borrower_name} ครบกำหนดผ่อน ฿{amount:,.2f} {when}",
            url="/",
        )
        sent += 1

    return sent
