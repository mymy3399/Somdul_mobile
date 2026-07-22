import logging
import os
from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import SQLModel

from app.config import settings, INSECURE_DEFAULT_SECRET_KEY
from app.database import engine
from app.routers import auth, wallets, credit_cards, debtors, transactions, recurring_payments, notifications, budgets, categories, quick_templates
from app.scheduler import run_daily_reminder_job

logger = logging.getLogger("uvicorn.error")

app = FastAPI(title=settings.PROJECT_NAME)
scheduler = BackgroundScheduler(timezone="UTC")

# Configure CORS (useful for development when running frontend on separate dev server)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict this to the frontend domains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database tables on startup (if not using Alembic migrations initially)
@app.on_event("startup")
def on_startup():
    SQLModel.metadata.create_all(engine)
    if settings.SECRET_KEY == INSECURE_DEFAULT_SECRET_KEY:
        logger.warning(
            "SECRET_KEY is using the built-in insecure default. "
            "Set the SECRET_KEY environment variable before running in production — "
            "all JWTs are currently signed with a key visible in the source code."
        )

    scheduler.add_job(
        run_daily_reminder_job,
        "cron",
        hour=settings.REMINDER_HOUR_UTC,
        minute=0,
        id="daily_reminder_digest",
        replace_existing=True,
    )
    scheduler.start()

@app.on_event("shutdown")
def on_shutdown():
    scheduler.shutdown(wait=False)

# Include API Routers
app.include_router(auth.router, prefix="/api")
app.include_router(wallets.router, prefix="/api")
app.include_router(credit_cards.router, prefix="/api")
app.include_router(debtors.router, prefix="/api")
app.include_router(transactions.router, prefix="/api")
app.include_router(recurring_payments.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(budgets.router, prefix="/api")
app.include_router(categories.router, prefix="/api")
app.include_router(quick_templates.router, prefix="/api")

# Serve frontend files from parent directory (/root/somdul)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# These three change often during active development, and a browser (or the
# PWA service worker's "network-first" fetch) silently serving a stale
# cached copy is exactly how a shipped feature can appear to be "just not
# there" for a user without any error. No caching, ever.
NO_CACHE_HEADERS = {"Cache-Control": "no-cache, no-store, must-revalidate"}

@app.get("/")
def read_root():
    index_path = os.path.join(BASE_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, headers=NO_CACHE_HEADERS)
    return {"message": "Somdul API is running. index.html not found."}

@app.get("/api.js")
def read_api_js():
    js_path = os.path.join(BASE_DIR, "api.js")
    if os.path.exists(js_path):
        return FileResponse(js_path, headers=NO_CACHE_HEADERS)
    return {"message": "api.js not found."}

@app.get("/app.js")
def read_app_js():
    js_path = os.path.join(BASE_DIR, "app.js")
    if os.path.exists(js_path):
        return FileResponse(js_path, headers=NO_CACHE_HEADERS)
    return {"message": "app.js not found."}

@app.get("/db.js")
def read_db_js():
    js_path = os.path.join(BASE_DIR, "db.js")
    if os.path.exists(js_path):
        return FileResponse(js_path, headers=NO_CACHE_HEADERS)
    return {"message": "db.js not found."}

@app.get("/manifest.json")
def read_manifest():
    manifest_path = os.path.join(BASE_DIR, "manifest.json")
    if os.path.exists(manifest_path):
        return FileResponse(manifest_path, media_type="application/manifest+json")
    return {"message": "manifest.json not found."}

@app.get("/sw.js")
def read_service_worker():
    sw_path = os.path.join(BASE_DIR, "sw.js")
    if os.path.exists(sw_path):
        # No caching on the service worker script itself — browsers already
        # re-check it on every navigation, and a cached stale copy would
        # prevent app-shell updates from ever being picked up.
        return FileResponse(sw_path, media_type="application/javascript", headers={"Cache-Control": "no-cache"})
    return {"message": "sw.js not found."}

# Icons directory (manifest.json icons, apple-touch-icon, favicon)
icons_dir = os.path.join(BASE_DIR, "icons")
if os.path.isdir(icons_dir):
    app.mount("/icons", StaticFiles(directory=icons_dir), name="icons")
