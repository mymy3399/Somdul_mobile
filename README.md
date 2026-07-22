# Somdul (สมดุล)

A Thai-language personal finance app: cash/bank wallets, credit cards, recurring
subscription payments, and a debtor/lending tracker (money lent to friends, or
credit-card purchases made "on behalf of" someone else, paid back in
installments). The full product spec is in [`prd.md`](prd.md) (Thai).

The app is a monolith — a FastAPI backend serves both the JSON API and the
static frontend files directly. No separate frontend build, bundler, or dev
server.

## Features

- Wallets (cash / bank account / e-wallet) and credit cards, with a shared
  transaction ledger for every money movement
- Recurring subscription payments with automatic monthly billing-cycle
  reconciliation
- Debtor/lending tracker: cash loans and credit-card installments paid back
  by someone else, including splitting a bill across multiple people
- Budgets per category, monthly spending trend chart, CSV export
- Optional daily email reminder digest for upcoming/overdue bills
- Installable as a PWA, and ships as a native Android APK (Capacitor) — see
  [`mobile/`](mobile/)
- Works offline: data is cached locally (IndexedDB) and edits made offline
  queue up and sync automatically once connectivity returns

## Running locally

```bash
# Start Postgres (from backend/)
cd backend
docker-compose up -d

# Backend (from backend/, using the existing venv)
source venv/bin/activate
uvicorn app.main:app --reload --port 8005
```

Then open `http://localhost:8005/` and register an account — the frontend
has no separate dev server, it's served by the same FastAPI process at the
root path, which calls the API at `/api`.

## Architecture

- **Backend** (`backend/app/`) — FastAPI + SQLModel + PostgreSQL. One router
  per resource under `backend/app/routers/` (`auth`, `wallets`,
  `credit_cards`, `debtors`, `transactions`, `recurring_payments`,
  `notifications`, `budgets`, `categories`, `quick_templates`), each behind
  JWT auth. Every mutable table carries `updated_at`/`deleted_at` and deletes
  are soft (tombstoned), so changes propagate correctly across devices.
- **Frontend** (repo root) — plain JS + Chart.js, no framework or build step.
  `api.js` is the data layer (fetches, JWT storage, the shared `state`
  object); `app.js` renders the UI from `state`; `db.js` is the offline
  cache/mutation-queue layer backing both.
- **Mobile** (`mobile/`) — a [Capacitor](https://capacitorjs.com) project
  wrapping the frontend in a native Android WebView shell.
  `.github/workflows/android-apk.yml` builds a debug APK on every push to
  `master` that touches the frontend or `mobile/`, uploaded as a workflow
  artifact (plus a signed release build if keystore secrets are configured).

See [`CLAUDE.md`](CLAUDE.md) for a deeper architectural walkthrough.
