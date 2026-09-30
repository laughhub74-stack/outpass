from fastapi import APIRouter, Depends, HTTPException, status, Request
from bson import ObjectId
from app.core.database import get_database
from app.core.security import verify_password, create_access_token, get_password_hash
from app.models.user import UserResponse
from app.routes.dependencies import get_current_user

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

@router.post("/login")
async def login(request: Request):
    content_type = request.headers.get("content-type", "")
    username = None
    password = None

    if "application/json" in content_type:
        data = await request.json()
        username = data.get("username") or data.get("email")
        password = data.get("password")
    else:
        form = await request.form()
        username = form.get("username") or form.get("email")
        password = form.get("password")

    if not username or not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email and password required"
        )

    username = username.strip().lower()
    db = get_database()
    user_doc = await db.users.find_one(
        {"email": username},
        {"photo": 0, "fingerprint_enrollment.pid_data_encrypted": 0},
    )
    if not user_doc or not verify_password(password, user_doc["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect email or password"
        )
    
    if user_doc.get("enrollment_status") != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive or suspended"
        )

    access_token = create_access_token(subject=user_doc["_id"])
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": user_doc["role"],
        "name": user_doc["name"],
        "department": user_doc.get("department"),
    }

@router.post("/login-json")
async def login_json(data: dict):
    email = data.get("email") or data.get("username")
    password = data.get("password")
    if not email or not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email and password required"
        )
        
    email = str(email).strip().lower()
    db = get_database()
    user_doc = await db.users.find_one(
        {"email": email},
        {"photo": 0, "fingerprint_enrollment.pid_data_encrypted": 0},
    )
    if not user_doc or not verify_password(password, user_doc["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect email or password"
        )
        
    if user_doc.get("enrollment_status") != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive or suspended"
        )

    access_token = create_access_token(subject=user_doc["_id"])
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": user_doc["role"],
        "name": user_doc["name"],
        "department": user_doc.get("department"),
    }

@router.post("/change-password")
async def change_password(
    request: Request,
    current_user: UserResponse = Depends(get_current_user),
):
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        data = await request.json()
    else:
        form = await request.form()
        data = form

    current_password = str(data.get("current_password") or data.get("old_password") or "").strip()
    new_password = str(data.get("new_password") or "").strip()
    confirm_password = str(data.get("confirm_password") or "").strip()

    if not current_password or not new_password or not confirm_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password, new password, and confirmation are required")
    if len(new_password) < 6:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password must be at least 6 characters long")
    if new_password != confirm_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password and confirmation do not match")

    db = get_database()
    user_doc = await db.users.find_one({"_id": ObjectId(current_user.id)}, {"password_hash": 1})
    if user_doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not verify_password(current_password, user_doc.get("password_hash", "")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    await db.users.update_one(
        {"_id": ObjectId(current_user.id)},
        {"$set": {"password_hash": get_password_hash(new_password)}},
    )
    return {"message": "Password updated successfully"}


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: UserResponse = Depends(get_current_user)):
    db = get_database()
    user_doc = await db.users.find_one(
        {"_id": ObjectId(current_user.id)},
        {"password_hash": 0, "fingerprint_enrollment": 0},
    )
    if user_doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return UserResponse(**{
        **user_doc,
        "fingerprint_enrolled": current_user.fingerprint_enrolled,
    })
