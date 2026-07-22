import os
import pathlib

# Point the app at a throwaway SQLite file instead of the real Postgres
# DATABASE_URL. Must happen before any `app.*` module is imported, since
# app/database.py builds its engine at import time from app.config.settings.
TEST_DB_PATH = pathlib.Path(__file__).parent / "test_somdul.db"
if TEST_DB_PATH.exists():
    TEST_DB_PATH.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH}"  # database.py rewrites this to the async sqlite+aiosqlite driver

import pytest
from fastapi.testclient import TestClient

from app.main import app  # noqa: E402  (must import after DATABASE_URL is set)
from app.rate_limit import _attempts as _rate_limit_attempts  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    # The rate limiter's bucket dict is module-level state shared across the
    # whole test session (TestClient always reports the same "testclient"
    # host), so without this, an earlier rate-limit test would poison every
    # later test's login/register calls.
    _rate_limit_attempts.clear()
    yield


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def auth_headers(client):
    def _make(email="user@example.com", password="Passw0rd!"):
        client.post("/api/auth/register", json={"name": "Test User", "email": email, "password": password})
        res = client.post("/api/auth/login", data={"username": email, "password": password})
        token = res.json()["access_token"]
        return {"Authorization": f"Bearer {token}"}
    return _make
