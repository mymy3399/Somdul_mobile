import os
from pydantic_settings import BaseSettings

INSECURE_DEFAULT_SECRET_KEY = "somdul_super_secret_signing_key_change_me_in_production"

class Settings(BaseSettings):
    PROJECT_NAME: str = "Somdul API"
    SECRET_KEY: str = os.getenv("SECRET_KEY", INSECURE_DEFAULT_SECRET_KEY)
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 1 day

    # Gates the SECRET_KEY check in main.py's startup handler — refuses to
    # boot with the insecure default key outside of local development, since
    # that key is visible to anyone reading this file on GitHub and lets
    # them forge a valid JWT for any user. Set ENVIRONMENT=production (or
    # anything other than "development") once you configure a real
    # SECRET_KEY for a real deployment.
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")

    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql://somdul:somdul_pass@127.0.0.1:5434/somdul"
    )

    # SQL query logging — useful while debugging locally, but real overhead
    # under load (every query serialized + written to stdout), so it's off
    # unless explicitly requested.
    SQL_ECHO: bool = os.getenv("SQL_ECHO", "false").lower() == "true"

    # Async engine connection pool (see database.py) — pool_size is the
    # number of connections kept open permanently; max_overflow is how many
    # more can be opened temporarily under burst load before new requests
    # start queueing for a free connection.
    DB_POOL_SIZE: int = int(os.getenv("DB_POOL_SIZE", "20"))
    DB_MAX_OVERFLOW: int = int(os.getenv("DB_MAX_OVERFLOW", "20"))

    # Email reminders (optional — the daily digest job silently no-ops if
    # these aren't set, since a fresh install has no mail server configured).
    SMTP_HOST: str = os.getenv("SMTP_HOST", "")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER: str = os.getenv("SMTP_USER", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_FROM: str = os.getenv("SMTP_FROM", "")
    NOTIFY_DAYS_BEFORE: int = int(os.getenv("NOTIFY_DAYS_BEFORE", "3"))
    REMINDER_HOUR_UTC: int = int(os.getenv("REMINDER_HOUR_UTC", "1"))  # ~08:00 Asia/Bangkok

    class Config:
        case_sensitive = True

settings = Settings()
