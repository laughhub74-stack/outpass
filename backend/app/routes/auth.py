from fastapi import APIRouter, Depends, HTTPException, status, Request
from bson import ObjectId
from app.core.database import get_database
from app.core.rate_limit import login_throttle
from app.core.security import verify_password, create_access_token, get_password_hash
from app.models.user import UserResponse
from app.routes.dependencies import get_current_user

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

def _client_ip(request: Request) -> str:
    # Behind a proxy (Render, etc.) the real client is the first X-Forwarded-For entry.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def _authenticate(request: Request, username, password) -> dict:
    # Reject non-text values (e.g. JSON objects/lists/numbers) with a clean 400
    # instead of crashing with a 500.
    if not isinstance(username, str) or not isinstance(password, str) or not username.strip() or not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email and password required"
        )
    if len(username) > 254 or len(password) > 128:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Incorrect email or password")

    username = username.strip().lower()
    ip_key = f"ip:{_client_ip(request)}"
    email_key = f"email:{username}"

    wait = login_throttle.retry_after(ip_key, email_key)
    if wait:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts. Please try again later.",
            headers={"Retry-After": str(wait)},
        )

    db = get_database()
    user_doc = await db.users.find_one(
        {"email": username},
        {"photo": 0, "fingerprint_enrollment.pid_data_encrypted": 0},
    )
    if not user_doc or not verify_password(password, user_doc.get("password_hash", "")):
        login_throttle.record_failure(ip_key, email_key)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect email or password"
        )

    if user_doc.get("enrollment_status") != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive or suspended"
        )

    login_throttle.reset(ip_key, email_key)
    access_token = create_access_token(subject=user_doc["_id"])
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": user_doc["role"],
        "name": user_doc["name"],
        "department": user_doc.get("department"),
    }


@router.post("/login")
async def login(request: Request):
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            data = await request.json()
        except Exception:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON body")
        if not isinstance(data, dict):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email and password required")
        username = data.get("username") or data.get("email")
        password = data.get("password")
    else:
        form = await request.form()
        username = form.get("username") or form.get("email")
        password = form.get("password")
    return await _authenticate(request, username, password)


@router.post("/login-json")
async def login_json(request: Request, data: dict):
    return await _authenticate(
        request,
        data.get("email") or data.get("username"),
        data.get("password"),
    )

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
    if not 8 <= len(new_password) <= 128:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password must be between 8 and 128 characters long")
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
