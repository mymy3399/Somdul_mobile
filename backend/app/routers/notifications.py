from typing import List
from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from pydantic import BaseModel

from app.database import get_session
from app.models import DismissedNotification, User
from app.security import get_current_user

router = APIRouter(prefix="/notifications", tags=["Notifications"])


class DismissSchema(BaseModel):
    notif_id: str


@router.get("/dismissed", response_model=List[str])
def list_dismissed(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    stmt = select(DismissedNotification.notif_id).where(DismissedNotification.user_id == current_user.id)
    return session.exec(stmt).all()


@router.post("/dismiss", status_code=204)
def dismiss(
    data: DismissSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    stmt = select(DismissedNotification).where(
        DismissedNotification.user_id == current_user.id,
        DismissedNotification.notif_id == data.notif_id,
    )
    if session.exec(stmt).first():
        return  # already dismissed, idempotent no-op

    session.add(DismissedNotification(user_id=current_user.id, notif_id=data.notif_id))
    session.commit()
    return
