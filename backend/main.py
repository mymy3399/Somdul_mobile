import logging
from contextlib import asynccontextmanager
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .database import init_db, SessionLocal
from .push_service import check_and_notify_due_bills, check_and_notify_due_loans
from .seed import seed_if_empty
from .routers import auth, transactions, recurring_bills, credit_cards, loans, dashboard, push, budgets

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
logger = logging.getLogger(__name__)


async def _run_due_bill_check() -> None:
    async with SessionLocal() as db:
        sent_bills = await check_and_notify_due_bills(db)
        sent_loans = await check_and_notify_due_loans(db)
        total = sent_bills + sent_loans
        if total:
            logger.info(
                "reminder sweep sent %d push notification(s) (%d bills, %d loans)",
                total, sent_bills, sent_loans,
            )


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    async with SessionLocal() as db:
        await seed_if_empty(db)

    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        _run_due_bill_check,
        "cron",
        hour=settings.BILL_REMINDER_HOUR,
        minute=0,
        id="due_bill_reminder",
    )
    scheduler.start()

    yield

    scheduler.shutdown(wait=False)


app = FastAPI(title="เงินทอง — ระบบจดรายรับรายจ่าย", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(transactions.router, prefix="/api")
app.include_router(recurring_bills.router, prefix="/api")
app.include_router(credit_cards.router, prefix="/api")
app.include_router(loans.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(push.router, prefix="/api")
app.include_router(budgets.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}


if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
