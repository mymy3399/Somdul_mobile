from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession
from app.config import settings


def _to_async_url(url: str) -> str:
    """Rewrite a plain postgresql://... or sqlite:///... DATABASE_URL to use
    its async driver, so existing DATABASE_URL values (env vars, docs, this
    file's own default) don't need to change to pick up async support."""
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("sqlite://"):
        return url.replace("sqlite://", "sqlite+aiosqlite://", 1)
    return url


# Async engine for request handlers (see routers/) — every route is `async
# def` and awaits its DB calls, so a request only ever occupies a connection
# for the duration of its own query instead of a whole worker thread for the
# life of the request. SQLite (used by the test suite) doesn't have a
# meaningful connection pool, so pool_size/max_overflow only take effect for
# Postgres; passing them to the SQLite driver would raise a TypeError.
_engine_kwargs = {"echo": settings.SQL_ECHO, "pool_pre_ping": True}
if _to_async_url(settings.DATABASE_URL).startswith("postgresql"):
    _engine_kwargs["pool_size"] = settings.DB_POOL_SIZE
    _engine_kwargs["max_overflow"] = settings.DB_MAX_OVERFLOW

engine = create_async_engine(_to_async_url(settings.DATABASE_URL), **_engine_kwargs)

_async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_session():
    """FastAPI dependency to provide database sessions."""
    async with _async_session_factory() as session:
        yield session
