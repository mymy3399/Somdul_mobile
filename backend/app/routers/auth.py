from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from pydantic import BaseModel, EmailStr
from typing import Optional

from app.database import get_session
from app.models import User
from app.notifier import send_password_reset_email
from app.rate_limit import rate_limiter
from app.security import (
    get_current_user,
    get_password_hash,
    verify_password,
    create_access_token,
    create_password_reset_token,
    verify_password_reset_token,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])

# 10 attempts per minute per IP is enough for a real user retyping a typo'd
# password a few times, but blunts brute-force / credential-stuffing loops.
login_rate_limit = rate_limiter(max_attempts=10, window_seconds=60)
register_rate_limit = rate_limiter(max_attempts=10, window_seconds=60)
change_password_rate_limit = rate_limiter(max_attempts=10, window_seconds=60)
forgot_password_rate_limit = rate_limiter(max_attempts=5, window_seconds=60)
reset_password_rate_limit = rate_limiter(max_attempts=10, window_seconds=60)

def validate_password_strength(password: str) -> None:
    if len(password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร"
        )
    if not any(char.isdigit() for char in password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว"
        )
    special_chars = "!@#$%^&*()_+-=[]{}|;':\",./<>?`~"
    if not any(char in special_chars for char in password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="รหัสผ่านต้องมีอักขระพิเศษอย่างน้อย 1 ตัว (เช่น !, @, #, $, %)"
        )

class RegisterSchema(BaseModel):
    name: str
    email: EmailStr
    password: str

class UpdateProfileSchema(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None

class ChangePasswordSchema(BaseModel):
    old_password: str
    new_password: str

class ForgotPasswordSchema(BaseModel):
    email: EmailStr

class ResetPasswordSchema(BaseModel):
    token: str
    new_password: str

class UserResponse(BaseModel):
    id: str
    name: str
    email: str
    promptpay_account: Optional[str] = None
    promptpay_qr_data: Optional[str] = None

    class Config:
        from_attributes = True

class PromptPayUpdateSchema(BaseModel):
    promptpay_account: Optional[str] = None
    promptpay_qr_data: Optional[str] = None

# ~1MB of base64 text is roughly ~750KB of raw image data — plenty for a QR
# PNG (typically a few KB to tens of KB), while keeping a hard cap on what
# gets stored as a TEXT column per user.
MAX_QR_DATA_URL_LENGTH = 1_000_000

def _user_response(user: User) -> "UserResponse":
    return UserResponse(
        id=str(user.id),
        name=user.name,
        email=user.email,
        promptpay_account=user.promptpay_account,
        promptpay_qr_data=user.promptpay_qr_data,
    )

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(data: RegisterSchema, session: AsyncSession = Depends(get_session), _rl=Depends(register_rate_limit)):
    # Validate password strength
    validate_password_strength(data.password)

    # Check if user already exists
    statement = select(User).where(User.email == data.email.lower())
    result = await session.exec(statement)
    existing_user = result.first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    # Create new user
    new_user = User(
        name=data.name,
        email=data.email.lower(),
        hashed_password=get_password_hash(data.password)
    )
    session.add(new_user)
    await session.commit()
    await session.refresh(new_user)
    return _user_response(new_user)

@router.post("/login", response_model=TokenResponse)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    session: AsyncSession = Depends(get_session),
    _rl=Depends(login_rate_limit)
):
    statement = select(User).where(User.email == form_data.username.lower())
    result = await session.exec(statement)
    user = result.first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect email or password"
        )

    # Create JWT access token
    access_token = create_access_token(data={"sub": user.email, "tv": user.token_version})
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=_user_response(user)
    )

@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return _user_response(current_user)

@router.put("/profile", response_model=UserResponse)
async def update_profile(
    data: UpdateProfileSchema,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    if data.name is not None:
        name_val = data.name.strip()
        if not name_val:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Name cannot be empty"
            )
        current_user.name = name_val

    if data.email is not None:
        email_lower = data.email.lower().strip()
        if email_lower != current_user.email:
            stmt = select(User).where(User.email == email_lower)
            result = await session.exec(stmt)
            existing_user = result.first()
            if existing_user:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email already in use"
                )
            current_user.email = email_lower

    session.add(current_user)
    await session.commit()
    await session.refresh(current_user)
    return _user_response(current_user)

@router.put("/promptpay", response_model=UserResponse)
async def update_promptpay(
    data: PromptPayUpdateSchema,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    if data.promptpay_qr_data is not None:
        if data.promptpay_qr_data and not data.promptpay_qr_data.startswith("data:image/"):
            raise HTTPException(status_code=400, detail="ไฟล์ที่อัปโหลดต้องเป็นรูปภาพ")
        if len(data.promptpay_qr_data) > MAX_QR_DATA_URL_LENGTH:
            raise HTTPException(status_code=400, detail="ไฟล์รูปภาพมีขนาดใหญ่เกินไป กรุณาเลือกไฟล์ที่เล็กลง")
        current_user.promptpay_qr_data = data.promptpay_qr_data or None

    if data.promptpay_account is not None:
        current_user.promptpay_account = data.promptpay_account.strip() or None

    session.add(current_user)
    await session.commit()
    await session.refresh(current_user)
    return _user_response(current_user)

@router.put("/password")
async def change_password(
    data: ChangePasswordSchema,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    _rl=Depends(change_password_rate_limit)
):
    if not verify_password(data.old_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect old password"
        )

    # Validate new password strength
    validate_password_strength(data.new_password)

    current_user.hashed_password = get_password_hash(data.new_password)
    # Invalidates every JWT issued before this point (see User.token_version
    # / get_current_user) — a lost/stolen device's old session can't keep
    # using the account just because its token hasn't expired yet.
    current_user.token_version += 1
    session.add(current_user)
    await session.commit()

    # Re-issue a token for *this* session so the user isn't immediately
    # logged out by the token_version bump they just triggered.
    new_token = create_access_token(data={"sub": current_user.email, "tv": current_user.token_version})
    return {
        "status": "success",
        "message": "Password updated successfully",
        "access_token": new_token,
        "token_type": "bearer",
    }

@router.post("/forgot-password")
async def forgot_password(
    data: ForgotPasswordSchema,
    session: AsyncSession = Depends(get_session),
    _rl=Depends(forgot_password_rate_limit)
):
    """Always returns the same generic response whether or not the email is
    registered, so this endpoint can't be used to enumerate accounts."""
    statement = select(User).where(User.email == data.email.lower())
    result = await session.exec(statement)
    user = result.first()
    if user:
        reset_token = create_password_reset_token(user.email, user.token_version)
        send_password_reset_email(user.email, user.name, reset_token)

    return {
        "status": "success",
        "message": "หากอีเมลนี้มีอยู่ในระบบ เราได้ส่งรหัสสำหรับตั้งรหัสผ่านใหม่ไปให้แล้ว",
    }

@router.post("/reset-password")
async def reset_password(
    data: ResetPasswordSchema,
    session: AsyncSession = Depends(get_session),
    _rl=Depends(reset_password_rate_limit)
):
    payload = verify_password_reset_token(data.token)
    invalid_token_exc = HTTPException(status_code=400, detail="โค้ดตั้งรหัสผ่านใหม่ไม่ถูกต้องหรือหมดอายุแล้ว")
    if payload is None:
        raise invalid_token_exc

    email = payload.get("sub")
    statement = select(User).where(User.email == email)
    result = await session.exec(statement)
    user = result.first()
    # The embedded tv must still match the user's *current* token_version —
    # it won't if this exact reset token was already used once (reset bumps
    # token_version below) or if the password was changed some other way
    # since the token was issued, so a captured/replayed reset link/code
    # can't be used a second time.
    if user is None or payload.get("tv") != user.token_version:
        raise invalid_token_exc

    validate_password_strength(data.new_password)

    user.hashed_password = get_password_hash(data.new_password)
    user.token_version += 1
    session.add(user)
    await session.commit()

    return {"status": "success", "message": "ตั้งรหัสผ่านใหม่สำเร็จแล้ว กรุณาเข้าสู่ระบบอีกครั้ง"}
