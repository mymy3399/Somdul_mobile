from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import hash_password
from .models import User


async def seed_if_empty(db: AsyncSession) -> None:
    result = await db.execute(select(User).limit(1))
    if result.scalar_one_or_none() is not None:
        return

    demo = User(
        username="demo",
        password_hash=hash_password("demo1234"),
        display_name="Demo User",
        role="user",
    )
    db.add(demo)
    await db.commit()
