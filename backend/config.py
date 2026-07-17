from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "sqlite+aiosqlite:///./expense.db"
    SECRET_KEY: str = "dev-secret-change-me"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    CORS_ORIGINS: str = "*"

    # Web push (VAPID). These defaults work out of the box for local/dev use;
    # generate your own pair for a real deployment (e.g. via `py_vapid`) and
    # override through the environment so only this instance can sign pushes
    # claiming to be from it.
    VAPID_PUBLIC_KEY: str = "BOBKgSDWZVzFP5rWARr9WrJwnXzU57bKrAUhK2ut2n49nUB9MxrdZOPGKYjcWSC2KU6fjguk6P5UKhLEQw8etoI"
    VAPID_PRIVATE_KEY: str = "IQRE6LHPyN9XiSxkFUZKjaFeAhNpkWk0uzLLXbEzYqY"
    VAPID_CLAIMS_EMAIL: str = "mailto:admin@example.com"
    BILL_REMINDER_HOUR: int = 8  # local hour the daily due-bill check runs

    @property
    def cors_origins_list(self) -> list[str]:
        if self.CORS_ORIGINS == "*":
            return ["*"]
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()
