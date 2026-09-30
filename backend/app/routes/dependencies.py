from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
import jwt
from jwt import PyJWTError as JWTError
from bson import ObjectId
from app.core.config import settings
from app.core.database import get_database
from app.core.hostels import get_assigned_hostel_name, hostel_name_filter, profile_hostel_name
from app.models.user import UserResponse

SUPER_ADMIN_ROLES = {"super_admin", "admin"}

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")

async def get_current_user(token: str = Depends(oauth2_scheme)) -> UserResponse:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    db = get_database()
    try:
        user_doc = await db.users.find_one(
            {"_id": ObjectId(user_id)},
            {"photo": 0, "password_hash": 0, "fingerprint_enrollment.pid_data_encrypted": 0},
        )
    except Exception:
        raise credentials_exception
        
    if user_doc is None:
        raise credentials_exception
    
    if user_doc.get("enrollment_status") != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive or suspended"
        )
        
    return UserResponse(**{
        **user_doc,
        "fingerprint_enrolled": bool(user_doc.get("fingerprint_enrollment")),
    })

class RoleChecker:
    def __init__(self, allowed_roles: list[str]):
        self.allowed_roles = allowed_roles

    def __call__(self, current_user: UserResponse = Depends(get_current_user)) -> UserResponse:
        if current_user.role not in self.allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Operation not permitted for role: {current_user.role}"
            )
        return current_user

# Database-level RBAC query enforcement helper
def get_role_based_outpass_filter(user: UserResponse) -> dict:
    """
    Enforces database-level query restriction to prevent API bypass/privilege escalation.
    Students: can only see their own requests.
    Advisors: see requests for their assigned department and academic year.
    HODs: see requests for their department once the advisor has approved.
    Wardens: see requests once the HOD has approved.
    Security: see 'Approved' or 'Student Left' or 'Student Returned' requests.
    Super admins see all requests; department admins are restricted to their department.
    """
    if user.role in SUPER_ADMIN_ROLES:
        return {}
    elif user.role == "department_admin":
        if not user.department:
            return {"_id": None}
        return {"department": user.department}
    elif user.role == "student":
        return {"student_id": ObjectId(user.id)}
    elif user.role == "advisor":
        if not user.department or user.year is None:
            return {"_id": None}
        return {"department": user.department, "status": {"$in": ["Pending", "Advisor Approved", "HOD Approved", "Warden Approved", "Approved", "Student Left", "Student Returned", "Rejected"]}}
    elif user.role == "hod":
        if not user.department:
            return {"_id": None}
        return {"department": user.department, "status": {"$in": ["Advisor Approved", "HOD Approved", "Warden Approved", "Approved", "Student Left", "Student Returned", "Rejected"]}}
    elif user.role == "warden":
        hostel_filter = hostel_name_filter(profile_hostel_name(user))
        if not hostel_filter:
            return {"_id": None}
        return {
            "hostel_name": hostel_filter,
            "status": {"$in": ["HOD Approved", "Warden Approved", "Approved", "Student Left", "Student Returned", "Rejected"]},
        }
    elif user.role == "security":
        return {"status": {"$in": ["Approved", "Student Left", "Student Returned"]}}
    else:
        # Fallback block
        return {"_id": None}


async def get_requester_outpass_filter(db, user: UserResponse) -> dict:
    """Resolve database assignments needed for a role-scoped outpass query."""
    query = get_role_based_outpass_filter(user)
    if user.role == "warden":
        hostel_filter = hostel_name_filter(await get_assigned_hostel_name(db, user))
        if not hostel_filter:
            return {"_id": None}
        query.pop("_id", None)
        query["hostel_name"] = hostel_filter
    return query
