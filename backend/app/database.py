from sqlmodel import create_engine, Session, SQLModel
from app.config import settings

# Create engine for synchronous PostgreSQL interaction
engine = create_engine(
    settings.DATABASE_URL,
    echo=True, # Log SQL queries for easier debugging during development
    pool_pre_ping=True
)

def get_session():
    """FastAPI dependency to provide database sessions."""
    with Session(engine) as session:
        yield session
