# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Somdul (สมดุล) is a Thai-language personal finance app: cash/bank wallets, credit cards, recurring subscription payments, and a debtor/lending tracker (money lent to friends, or credit-card purchases made "on behalf of" someone else, paid back in installments). The product spec is in `prd.md` (Thai) — read it for the intended business logic behind debt sharing and repayment flows if a feature seems ambiguous.

The app is a monolith: a FastAPI backend serves both the JSON API and the static frontend files directly (no separate frontend build/dev server, no framework/bundler).

## Architecture

**Backend** (`backend/app/`, FastAPI + SQLModel + PostgreSQL):
- `main.py` — app entrypoint. Registers routers under `/api`, creates DB tables on startup via `SQLModel.metadata.create_all`, starts an in-process APScheduler `BackgroundScheduler` (daily reminder job), and also serves `index.html`, `api.js`, `app.js` from the repo root (`BASE_DIR` is computed as three levels up from `main.py`) — this is why the frontend lives in the repo root instead of a `static/` folder.
- `models.py` — all SQLModel table definitions in one file: `User`, `Wallet`, `CreditCard`, `Debtor`, `Debt`, `Transaction`, `RecurringPayment`, `DismissedNotification`, `Budget`. `Transaction` is the shared ledger for all money movement (wallet and credit-card ins/outs alike).
- `routers/` — one router per resource (`auth`, `wallets`, `credit_cards`, `debtors`, `transactions`, `recurring_payments`, `notifications`, `budgets`), each owning its own Pydantic request/response schemas inline (no separate `schemas.py`). Every route depends on `get_current_user` (JWT-based) and scopes queries to `current_user.id` — always filter by user when adding queries.
- `security.py` — password hashing (bcrypt) and JWT creation/validation (`python-jose`). Token endpoint is `/api/auth/login` (OAuth2 password flow).
- `rate_limit.py` — a simple in-memory per-IP sliding-window limiter (module-level dict, single-process only); applied to `/api/auth/login` and `/api/auth/register`.
- `notifier.py` / `scheduler.py` — optional email reminder digest. `scheduler.py`'s `run_daily_reminder_job` (registered as an APScheduler cron job in `main.py`, hour controlled by `REMINDER_HOUR_UTC`) walks every user's upcoming/overdue recurring payments, credit card bills, and debts due within `NOTIFY_DAYS_BEFORE` days, and calls `notifier.send_reminder_email`. `notifier.is_email_configured()` gates everything on `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` being set — with none of those set (the default), it silently no-ops rather than erroring. LINE Notify was considered but is dead (shut down 2025-04-01); email was used instead since every `User` already has one.
- `database.py` / `config.py` — synchronous SQLAlchemy engine and `pydantic-settings`-based config (`DATABASE_URL`, `SECRET_KEY`, SMTP settings, `NOTIFY_DAYS_BEFORE` via env vars).
- `seed.py` — deletes and recreates a demo user (`demo@somdul.com` / `password123`) with sample wallets, cards, debts, transactions, and recurring payments. Also wired up as `POST /api/auth/reset` (requires auth).

**No migration tool in active use** despite `alembic` being in `requirements.txt` — schema changes ship as edits to `models.py` plus, if altering a table that already exists on the live DB, a manual `ALTER TABLE` via `docker exec somdul-db psql ...` (see `RecurringPayment.last_paid_at` for the precedent). `SQLModel.metadata.create_all()` on startup only creates *new* tables; it never alters existing ones.

**Money-movement invariant**: business logic mutates balances directly on the row (`Wallet.balance`, `CreditCard.current_balance`, `Debt.remaining_amount`) *and* inserts a `Transaction` audit row in the same request — see `routers/debtors.py::create_debt`/`repay_debt` and `routers/credit_cards.py::pay_credit_card` for the pattern to follow when adding new money-moving endpoints.

**Debt model specifics** (see `prd.md` section 4 for the full user-flow spec):
- `debt_type` is `CASH_LOAN` or `CREDIT_CARD_INSTALLMENT` (routers also tolerate legacy `INSTALLMENT`/`SHARED_SUBSCRIPTION` values for cash-based debts).
- `CREDIT_CARD_INSTALLMENT` debts increase the linked `CreditCard.current_balance` immediately by the full amount (the cardholder owes the bank right away) while the `Debt.remaining_amount` tracks what the debtor still owes the user.
- `repay_debt` derives `remaining_installments` from `remaining_amount` (`ceil(remaining_amount / (total_amount/total_installments))`) rather than decrementing by 1 per call, so the two fields can't drift apart when a payment doesn't match a full installment.
- There's no dedicated "split bill across N people" model — the frontend's split-bill UI (`debtModal`'s "แชร์บิลนี้ให้หลายคน" checkbox) just calls `POST /debtors/debts` once per person with an evenly-divided share (last person absorbs the rounding remainder).

**Recurring payments auto-rollover**: `RecurringPayment.status` flips `PAID` → `WAITING` lazily, reconciled on every `GET /recurring-payments` call (`routers/recurring_payments.py::_reconcile_billing_cycle`) once the calendar month has advanced past `last_paid_at` — there is no separate cron for this, just read-time reconciliation.

**Frontend** (repo root, plain JS + Chart.js, no build step):
- `index.html` — single-page app shell (loads Chart.js, Google Fonts (Prompt/Outfit for Thai text), `api.js`, then `app.js`).
- `api.js` — API/data layer: holds the shared reactive `state` object (wallets, creditCards, debtors, transactions, currentUser, dismissedNotifications, budgets, monthlyTrend, etc.), all `fetch()` calls to `/api/...`, JWT storage in `localStorage` (`somdul_jwt_token`), and auth helpers (`apiLogin`, `apiRegister`, `apiLogout`, `apiFetchAllData`).
- `app.js` — UI/rendering layer built directly on top of `api.js`'s `state`: DOM rendering functions (`render*`), modal open/close handlers, tab switching, and charts (overview donut + monthly trend bar chart in the history tab). No component framework — functions query/mutate the DOM directly and are wired via inline `onclick`/event listeners in `index.html`. Any function invoked from an inline `onclick` in dynamically-generated HTML must also be assigned to `window.<name>` near the bottom of the file (plain top-level `function` declarations are already global, but the codebase does this explicitly for onclick-invoked functions as a convention — follow it for new ones).
- `archive/index-prototype.html` — a large standalone prototype/mockup, not wired into the served app; treat as a design reference, not live code.
- `manifest.json`, `sw.js`, `icons/` — PWA support (installable on mobile, standalone display). `main.py` serves `manifest.json`/`sw.js` as explicit routes (same pattern as `api.js`/`app.js`) and mounts `icons/` via `StaticFiles`. The service worker is network-first for the app shell and explicitly bypasses `/api/*` (financial data must never be served stale from cache) — see `sw.js` for the exact rules before changing caching behavior. Icons were generated with `PIL` (a throwaway venv, not a project dependency) — regenerate by writing a similar script if the brand mark changes; there's no source SVG checked in.

## Running locally

```bash
# Start Postgres (from backend/)
docker-compose up -d

# Backend (from backend/, using the existing venv)
source venv/bin/activate
uvicorn app.main:app --reload --port 8005

# Seed demo data (demo@somdul.com / password123)
python -m app.seed
```

The frontend has no separate dev server — visiting the backend root (`http://localhost:8005/`) serves `index.html`, which calls the API at `/api`.

In production this runs as a systemd service (`/etc/systemd/system/somdul.service`, `uvicorn app.main:app --host 0.0.0.0 --port 8005`), restarted via `systemctl restart somdul`. A Caddy reverse proxy (`caddy.service`, config at `/etc/caddy/Caddyfile`) terminates TLS in front of it with a self-signed cert from Caddy's local CA (`https://192.168.0.226/`, `https://localhost/`) and redirects plain HTTP to HTTPS — needed for the service worker, which browsers refuse to register over an insecure origin. Port 8005 is still directly reachable over plain HTTP too (Caddy wasn't set up to be the only path in).

Database backup/restore: `backend/scripts/backup.sh {backup|restore|list}` — wraps `pg_dump`/`psql` against the `somdul-db` Docker container.

There is no linter or frontend build/lint step configured in this repo.

## Testing

Backend tests live in `backend/tests/` (pytest + FastAPI `TestClient`), run against a throwaway SQLite file (not the real Postgres DB) via a `DATABASE_URL` override in `conftest.py` — no Docker/Postgres needed to run them:

```bash
cd backend && source venv/bin/activate
python -m pytest tests/ -v
```

`conftest.py`'s `client` fixture triggers app startup per test; the `auth_headers` fixture registers+logs in a throwaway user. The rate limiter's bucket dict is module-level global state shared across the whole test session, so an `autouse` fixture clears it before every test — keep that in mind if a new test starts failing/passing depending on run order.
