from datetime import datetime
from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select
from pydantic import BaseModel
from decimal import Decimal

from app.database import get_session
from app.models import Wallet, User
from app.security import get_current_user

router = APIRouter(prefix="/wallets", tags=["Wallets"])

class WalletCreateSchema(BaseModel):
    wallet_name: str
    wallet_type: str # CASH, BANK_ACCOUNT, E_WALLET
    balance: Decimal = Decimal("0.00")

class WalletUpdateSchema(BaseModel):
    wallet_name: str
    wallet_type: str
    balance: Decimal

class WalletResponseSchema(BaseModel):
    id: UUID
    wallet_name: str
    wallet_type: str
    balance: Decimal

    class Config:
        from_attributes = True

@router.get("", response_model=List[WalletResponseSchema])
def list_wallets(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    statement = select(Wallet).where(Wallet.user_id == current_user.id, Wallet.deleted_at == None)
    return session.exec(statement).all()

@router.post("", response_model=WalletResponseSchema, status_code=status.HTTP_201_CREATED)
def create_wallet(
    data: WalletCreateSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    new_wallet = Wallet(
        user_id=current_user.id,
        wallet_name=data.wallet_name,
        wallet_type=data.wallet_type,
        balance=data.balance
    )
    session.add(new_wallet)
    session.commit()
    session.refresh(new_wallet)
    return new_wallet

@router.put("/{wallet_id}", response_model=WalletResponseSchema)
def update_wallet(
    wallet_id: UUID,
    data: WalletUpdateSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    statement = select(Wallet).where(Wallet.id == wallet_id, Wallet.user_id == current_user.id, Wallet.deleted_at == None)
    wallet = session.exec(statement).first()
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")

    wallet.wallet_name = data.wallet_name
    wallet.wallet_type = data.wallet_type
    wallet.balance = data.balance
    wallet.updated_at = datetime.utcnow()

    session.add(wallet)
    session.commit()
    session.refresh(wallet)
    return wallet

@router.delete("/{wallet_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_wallet(
    wallet_id: UUID,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    statement = select(Wallet).where(Wallet.id == wallet_id, Wallet.user_id == current_user.id, Wallet.deleted_at == None)
    wallet = session.exec(statement).first()
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")

    wallet.deleted_at = datetime.utcnow()
    wallet.updated_at = wallet.deleted_at
    session.add(wallet)
    session.commit()
    return
