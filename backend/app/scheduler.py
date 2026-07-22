import calendar
import logging
from datetime import date

from sqlmodel import Session, select

from app.config import settings
from app.database import engine
from app.models import CreditCard, Debt, Debtor, RecurringPayment, User
from app.notifier import send_reminder_email

logger = logging.getLogger("uvicorn.error")


def days_until_due(due_day: int, today: date | None = None) -> int:
    """Days remaining until `due_day` of the current month, or next month if
    this month's due date has already passed. Clamps to the last valid day
    of a month (e.g. due_day=31 in February)."""
    today = today or date.today()
    year, month = today.year, today.month

    last_day = calendar.monthrange(year, month)[1]
    target = date(year, month, min(due_day, last_day))

    if target < today:
        month += 1
        if month > 12:
            month = 1
            year += 1
        last_day = calendar.monthrange(year, month)[1]
        target = date(year, month, min(due_day, last_day))

    return (target - today).days


def _build_digest_for_user(session: Session, user: User) -> list[str]:
    within = settings.NOTIFY_DAYS_BEFORE
    items: list[str] = []

    recs = session.exec(
        select(RecurringPayment).where(RecurringPayment.user_id == user.id, RecurringPayment.status == "WAITING")
    ).all()
    for r in recs:
        d = days_until_due(r.due_day)
        if 0 <= d <= within:
            items.append(f"ค่าบริการ {r.name} ฿{r.amount:,.2f} ครบกำหนดใน {d} วัน")

    cards = session.exec(
        select(CreditCard).where(CreditCard.user_id == user.id, CreditCard.current_balance > 0)
    ).all()
    for c in cards:
        d = days_until_due(c.due_day)
        if 0 <= d <= within:
            items.append(f"บัตร {c.card_name} ยอดค้าง ฿{c.current_balance:,.2f} ครบกำหนดใน {d} วัน")

    debtors = session.exec(select(Debtor).where(Debtor.user_id == user.id)).all()
    for debtor in debtors:
        debts = session.exec(
            select(Debt).where(Debt.debtor_id == debtor.id, Debt.status != "PAID")
        ).all()
        for debt in debts:
            d = days_until_due(debt.due_day)
            if 0 <= d <= within:
                items.append(f"{debtor.debtor_name} ค้างคืน ฿{debt.remaining_amount:,.2f} ครบกำหนดใน {d} วัน")

    return items


def run_daily_reminder_job() -> None:
    logger.info("[scheduler] Running daily reminder digest job")
    with Session(engine) as session:
        users = session.exec(select(User)).all()
        for user in users:
            items = _build_digest_for_user(session, user)
            if items:
                send_reminder_email(user.email, user.name, items)
