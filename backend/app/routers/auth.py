from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session, select
from pydantic import BaseModel, EmailStr
from typing import Optional

from app.database import get_session
from app.models import User
from app.rate_limit import rate_limiter
from app.security import get_current_user, get_password_hash, verify_password, create_access_token

router = APIRouter(prefix="/auth", tags=["Authentication"])

# 10 attempts per minute per IP is enough for a real user retyping a typo'd
# password a few times, but blunts brute-force / credential-stuffing loops.
login_rate_limit = rate_limiter(max_attempts=10, window_seconds=60)
register_rate_limit = rate_limiter(max_attempts=10, window_seconds=60)

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
def register(data: RegisterSchema, session: Session = Depends(get_session), _rl=Depends(register_rate_limit)):
    # Validate password strength
    validate_password_strength(data.password)
    
    # Check if user already exists
    statement = select(User).where(User.email == data.email.lower())
    existing_user = session.exec(statement).first()
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
    session.commit()
    session.refresh(new_user)
    return _user_response(new_user)

@router.post("/login", response_model=TokenResponse)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    session: Session = Depends(get_session),
    _rl=Depends(login_rate_limit)
):
    statement = select(User).where(User.email == form_data.username.lower())
    user = session.exec(statement).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect email or password"
        )
    
    # Create JWT access token
    access_token = create_access_token(data={"sub": user.email})
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=_user_response(user)
    )

@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return _user_response(current_user)

@router.put("/profile", response_model=UserResponse)
def update_profile(
    data: UpdateProfileSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
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
            existing_user = session.exec(stmt).first()
            if existing_user:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email already in use"
                )
            current_user.email = email_lower

    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return _user_response(current_user)

@router.put("/promptpay", response_model=UserResponse)
def update_promptpay(
    data: PromptPayUpdateSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
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
    session.commit()
    session.refresh(current_user)
    return _user_response(current_user)

@router.put("/password")
def change_password(
    data: ChangePasswordSchema,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    if not verify_password(data.old_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect old password"
        )
    
    # Validate new password strength
    validate_password_strength(data.new_password)
    
    current_user.hashed_password = get_password_hash(data.new_password)
    session.add(current_user)
    session.commit()
    return {"status": "success", "message": "Password updated successfully"}
