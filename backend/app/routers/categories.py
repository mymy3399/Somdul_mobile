import uuid
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models import Category, User
from app.security import get_current_user

router = APIRouter(prefix="/categories", tags=["Categories"])

# Ported 1:1 from the frontend's previously-hardcoded CATEGORIES map, so
# existing transactions (which already carry these keys, e.g. "FOOD") keep
# resolving to the same name/icon/color after this becomes user-editable.
DEFAULT_CATEGORIES = [
    {"key": "FOOD", "name": "อาหารและเครื่องดื่ม", "tx_type": "EXPENSE", "icon": "fa-utensils", "color": "amber"},
    {"key": "TRANSPORT", "name": "เดินทาง/คมนาคม", "tx_type": "EXPENSE", "icon": "fa-car", "color": "blue"},
    {"key": "SHOPPING", "name": "ช้อปปิ้ง", "tx_type": "EXPENSE", "icon": "fa-bag-shopping", "color": "purple"},
    {"key": "STREAMING", "name": "บันเทิง/สตรีมมิ่ง", "tx_type": "EXPENSE", "icon": "fa-play", "color": "red"},
    {"key": "HOUSING", "name": "ที่พัก/สาธารณูปโภค", "tx_type": "EXPENSE", "icon": "fa-house-chimney", "color": "indigo"},
    {"key": "HEALTH", "name": "สุขภาพ/ความงาม", "tx_type": "EXPENSE", "icon": "fa-heart-pulse", "color": "rose"},
    {"key": "DEBT", "name": "ให้ยืม/หนี้สิน", "tx_type": "EXPENSE", "icon": "fa-hand-holding-dollar", "color": "teal"},
    {"key": "OTHER_EXP", "name": "อื่นๆ (รายจ่าย)", "tx_type": "EXPENSE", "icon": "fa-ellipsis", "color": "slate"},
    {"key": "SALARY", "name": "เงินเดือน/ค่าจ้าง", "tx_type": "INCOME", "icon": "fa-money-bill-wave", "color": "emerald"},
    {"key": "REFUND", "name": "โอนคืนจากลูกหนี้", "tx_type": "INCOME", "icon": "fa-rotate-left", "color": "cyan"},
    {"key": "BUSINESS", "name": "ขายของ/รายเสริม", "tx_type": "INCOME", "icon": "fa-store", "color": "orange"},
    {"key": "OTHER_INC", "name": "อื่นๆ (รายรับ)", "tx_type": "INCOME", "icon": "fa-coins", "color": "yellow"},
]


def ensure_categories_seeded(session: Session, user_id: UUID) -> None:
    existing = session.exec(select(Category).where(Category.user_id == user_id)).first()
    if existing:
        return
    for c in DEFAULT_CATEGORIES:
        session.add(Category(user_id=user_id, **c))
    session.commit()


class CategoryCreateSchema(BaseModel):
    name: str
    tx_type: str  # EXPENSE or INCOME
    icon: str = "fa-tag"
    color: str = "slate"


class CategoryUpdateSchema(BaseModel):
    name: Optional[str] = None
    tx_type: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None


class CategoryResponseSchema(BaseModel):
    id: UUID
    key: str
    name: str
    tx_type: str
    icon: str
    color: str

    class Config:
        from_attributes = True


@router.get("", response_model=List[CategoryResponseSchema])
def list_categories(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    ensure_categories_seeded(session, current_user.id)
    stmt = select(Category).where(Category.user_id == current_user.id)
    return session.exec(stmt).all()


@router.post("", response_model=CategoryResponseSchema, status_code=status.HTTP_201_CREATED)
def create_category(
    data: CategoryCreateSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    if data.tx_type not in ("EXPENSE", "INCOME"):
        raise HTTPException(status_code=400, detail="tx_type must be EXPENSE or INCOME")

    ensure_categories_seeded(session, current_user.id)
    category = Category(
        user_id=current_user.id,
        key=f"CUSTOM_{uuid.uuid4().hex[:8].upper()}",
        name=data.name,
        tx_type=data.tx_type,
        icon=data.icon,
        color=data.color,
    )
    session.add(category)
    session.commit()
    session.refresh(category)
    return category


@router.put("/{category_id}", response_model=CategoryResponseSchema)
def update_category(
    category_id: UUID,
    data: CategoryUpdateSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    stmt = select(Category).where(Category.id == category_id, Category.user_id == current_user.id)
    category = session.exec(stmt).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    if data.tx_type is not None and data.tx_type not in ("EXPENSE", "INCOME"):
        raise HTTPException(status_code=400, detail="tx_type must be EXPENSE or INCOME")

    if data.name is not None:
        category.name = data.name
    if data.tx_type is not None:
        category.tx_type = data.tx_type
    if data.icon is not None:
        category.icon = data.icon
    if data.color is not None:
        category.color = data.color

    session.add(category)
    session.commit()
    session.refresh(category)
    return category


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    stmt = select(Category).where(Category.id == category_id, Category.user_id == current_user.id)
    category = session.exec(stmt).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    session.delete(category)
    session.commit()
    return
