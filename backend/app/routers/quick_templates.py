from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.database import get_session
from app.models import QuickTemplate, User
from app.routers.categories import ensure_categories_seeded
from app.security import get_current_user

router = APIRouter(prefix="/quick-templates", tags=["Quick Templates"])

# Ported 1:1 from the frontend's previously-hardcoded QUICK_TEMPLATES array
# (minus the special frontend-only "CUSTOM" sentinel entry).
DEFAULT_QUICK_TEMPLATES = [
    {"label": "🍜 ข้าวกลางวัน/อาหารค่ำ", "description": "ค่าอาหารกลางวัน", "category_key": "FOOD"},
    {"label": "☕ กาแฟ/เครื่องดื่ม", "description": "กาแฟแก้วโปรด", "category_key": "FOOD"},
    {"label": "🍕 สั่งอาหารเดลิเวอรี", "description": "สั่ง Delivery มื้อค่ำ", "category_key": "FOOD"},
    {"label": "🚇 ค่ารถไฟฟ้า / MRT / BTS", "description": "ค่าเดินทางรถสาธารณะ", "category_key": "TRANSPORT"},
    {"label": "⛽ เติมน้ำมันรถ", "description": "เติมน้ำมันรถยนต์", "category_key": "TRANSPORT"},
    {"label": "🚗 เรียก Grab / Taxi", "description": "ค่าบริการ Grab / Taxi", "category_key": "TRANSPORT"},
    {"label": "👕 ซื้อเสื้อผ้า/แฟชั่น", "description": "ซื้อเสื้อผ้าใหม่", "category_key": "SHOPPING"},
    {"label": "🛒 ซื้อของเข้าบ้าน/ของชำ", "description": "ซื้อของชำเข้าบ้าน", "category_key": "SHOPPING"},
    {"label": "📺 หารค่า Netflix", "description": "จ่าย Netflix แชร์กลุ่ม", "category_key": "STREAMING"},
    {"label": "🎵 จ่าย Spotify", "description": "จ่าย Spotify Premium", "category_key": "STREAMING"},
    {"label": "🍿 ดูหนังโรงภาพยนตร์", "description": "ตั๋วหนังและป๊อปคอร์น", "category_key": "STREAMING"},
    {"label": "⚡ ค่าไฟฟ้า / ค่าน้ำประปา", "description": "จ่ายค่าไฟฟ้ารายเดือน", "category_key": "HOUSING"},
    {"label": "🏠 ค่าอินเทอร์เน็ตบ้าน", "description": "ค่าอินเทอร์เน็ตบ้าน", "category_key": "HOUSING"},
    {"label": "💊 ค่ายา / ค่ารักษาพยาบาล", "description": "ซื้อยา/อาหารเสริม", "category_key": "HEALTH"},
    {"label": "💇 ตัดผม / ทำเล็บ / สกินแคร์", "description": "บริการตัดผมแต่งทรง", "category_key": "HEALTH"},
    {"label": "💵 เงินเดือนโอนเข้า", "description": "เงินเดือนประจำออก", "category_key": "SALARY"},
    {"label": "💻 รับเงินค่าจ้างฟรีแลนซ์", "description": "ค่าจ้างฟรีแลนซ์/งานเสริม", "category_key": "SALARY"},
    {"label": "💰 ขายของออนไลน์ได้เงิน", "description": "รายได้จากการขายสินค้า", "category_key": "BUSINESS"},
]


async def _ensure_templates_seeded(session: AsyncSession, user_id: UUID) -> None:
    result = await session.exec(select(QuickTemplate).where(QuickTemplate.user_id == user_id, QuickTemplate.deleted_at == None))
    existing = result.first()
    if existing:
        return
    for t in DEFAULT_QUICK_TEMPLATES:
        session.add(QuickTemplate(user_id=user_id, **t))
    await session.commit()


class QuickTemplateCreateSchema(BaseModel):
    label: str
    description: str
    category_key: str


class QuickTemplateUpdateSchema(BaseModel):
    label: Optional[str] = None
    description: Optional[str] = None
    category_key: Optional[str] = None


class QuickTemplateResponseSchema(BaseModel):
    id: UUID
    label: str
    description: str
    category_key: str

    class Config:
        from_attributes = True


@router.get("", response_model=List[QuickTemplateResponseSchema])
async def list_quick_templates(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    await ensure_categories_seeded(session, current_user.id)  # so category_key options exist for new users
    await _ensure_templates_seeded(session, current_user.id)
    stmt = select(QuickTemplate).where(QuickTemplate.user_id == current_user.id, QuickTemplate.deleted_at == None)
    result = await session.exec(stmt)
    return result.all()


@router.post("", response_model=QuickTemplateResponseSchema, status_code=status.HTTP_201_CREATED)
async def create_quick_template(
    data: QuickTemplateCreateSchema,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    await _ensure_templates_seeded(session, current_user.id)
    template = QuickTemplate(
        user_id=current_user.id,
        label=data.label,
        description=data.description,
        category_key=data.category_key,
    )
    session.add(template)
    await session.commit()
    await session.refresh(template)
    return template


@router.put("/{template_id}", response_model=QuickTemplateResponseSchema)
async def update_quick_template(
    template_id: UUID,
    data: QuickTemplateUpdateSchema,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    stmt = select(QuickTemplate).where(QuickTemplate.id == template_id, QuickTemplate.user_id == current_user.id, QuickTemplate.deleted_at == None)
    result = await session.exec(stmt)
    template = result.first()
    if not template:
        raise HTTPException(status_code=404, detail="Quick template not found")

    if data.label is not None:
        template.label = data.label
    if data.description is not None:
        template.description = data.description
    if data.category_key is not None:
        template.category_key = data.category_key
    template.updated_at = datetime.utcnow()

    session.add(template)
    await session.commit()
    await session.refresh(template)
    return template


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_quick_template(
    template_id: UUID,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    stmt = select(QuickTemplate).where(QuickTemplate.id == template_id, QuickTemplate.user_id == current_user.id, QuickTemplate.deleted_at == None)
    result = await session.exec(stmt)
    template = result.first()
    if not template:
        raise HTTPException(status_code=404, detail="Quick template not found")

    template.deleted_at = datetime.utcnow()
    template.updated_at = template.deleted_at
    session.add(template)
    await session.commit()
    return
