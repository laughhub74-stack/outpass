import csv
import io
import logging
import re
import asyncio
from pydantic import BaseModel, Field, field_validator
from app.core.config import settings
from datetime import datetime
from typing import Literal, Optional
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, status, Query
from bson import ObjectId
from app.core.database import get_database
from app.core.security import get_password_hash
from app.models.user import (
    UserCreate, UserResponse, UserUpdate, VALID_ROLES,
    DEPARTMENT_SCOPED_ROLES,
)
from app.models.outpass import OutpassResponse, to_naive_utc
from app.models.audit import AuditLogResponse
from app.models.pagination import PaginatedResponse, build_page
from app.routes.dependencies import RoleChecker, SUPER_ADMIN_ROLES
from app.services.biometric import encrypt_biometric_payload

logger = logging.getLogger("homs_admin")
router = APIRouter(prefix="/api/admin", tags=["Admin Management"])

ADMIN_READ_ROLES = ["super_admin", "department_admin", "admin"]
SUPER_ADMIN_ROLE_LIST = ["super_admin", "admin"]
DEPARTMENT_ADMIN_MANAGED_ROLES = {"student", "advisor", "hod"}
SENSITIVE_AUDIT_FIELDS = {"password", "password_hash", "fingerprint_enrollment", "photo"}
ADMIN_OUTPASS_STATUSES = Literal[
    "Pending",
    "Advisor Approved",
    "HOD Approved",
    "Warden Approved",
    "Approved",
    "Student Left",
    "Student Returned",
    "Rejected",
]


class AdminOutpassUpdate(BaseModel):
    destination: Optional[str] = Field(None, min_length=3, max_length=100)
    reason: Optional[str] = Field(None, min_length=5, max_length=500)
    out_date: Optional[datetime] = None
    in_date: Optional[datetime] = None
    status: Optional[ADMIN_OUTPASS_STATUSES] = None

    model_config = {"extra": "forbid"}

    @field_validator("out_date", "in_date")
    @classmethod
    def normalise_dates(cls, value):
        return to_naive_utc(value) if value is not None else value


def is_department_admin(user: UserResponse) -> bool:
    return user.role == "department_admin"


def ensure_department_admin_can_manage(
    actor: UserResponse,
    target_user: dict,
    requested_changes: dict | None = None,
) -> None:
    """Restrict department admins to their own students and faculty members."""
    if not is_department_admin(actor):
        return
    if not actor.department:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Department admin has no assigned department")
    if (
        target_user.get("role") not in DEPARTMENT_ADMIN_MANAGED_ROLES
        or target_user.get("department") != actor.department
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Department admins can manage only student, advisor, and HOD users in their own department",
        )
    if requested_changes is not None:
        next_role = requested_changes.get("role", target_user.get("role"))
        next_department = requested_changes.get("department", target_user.get("department"))
        if next_role not in DEPARTMENT_ADMIN_MANAGED_ROLES or next_department != actor.department:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Department admins cannot move users outside their department or change them to a restricted role",
            )

def serialize_value(val):
    if isinstance(val, ObjectId):
        return str(val)
    elif isinstance(val, list):
        return [serialize_value(item) for item in val]
    elif isinstance(val, dict):
        return {k: serialize_value(v) for k, v in val.items()}
    return val

def get_changed_fields(old_dict: dict, new_dict: dict) -> dict:
    """
    Compares two dicts and returns a map of changes: {field: [old_val, new_val]}
    """
    changes = {}
    for key, value in new_dict.items():
        if key in SENSITIVE_AUDIT_FIELDS:
            continue
        old_val = old_dict.get(key)
        if old_val != value:
            changes[key] = [serialize_value(old_val), serialize_value(value)]
    return changes


def user_response(user_doc: dict) -> UserResponse:
    """Build a public user response without exposing biometric material."""
    return UserResponse(**{
        **user_doc,
        "fingerprint_enrolled": bool(user_doc.get("fingerprint_enrollment")),
    })

async def log_admin_action(db, actor: UserResponse, action: str, model: str, affected_id: ObjectId, old_state: dict, new_state: dict):
    changes = get_changed_fields(old_state, new_state)
    if not changes:
        if "DELETE" in action:
            changes = {k: [serialize_value(v), None] for k, v in old_state.items() if k not in SENSITIVE_AUDIT_FIELDS}
        else:
            return
        
    audit_doc = {
        "timestamp": datetime.utcnow(),
        "actor_id": ObjectId(actor.id),
        "actor_name": actor.name,
        "action": action,
        "affected_model": model,
        "affected_id": affected_id,
        "changes": changes,
        "immutable": True
    }
    await db.audit_logs.insert_one(audit_doc)

@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    user_in: UserCreate,
    current_user: UserResponse = Depends(RoleChecker(ADMIN_READ_ROLES))
):
    db = get_database()
    
    # Check if email exists
    existing_email = await db.users.find_one({"email": user_in.email})
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Check if roll number exists (only for students)
    if user_in.roll_number:
        existing_roll = await db.users.find_one({"roll_number": user_in.roll_number})
        if existing_roll:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Roll number already registered"
            )
            
    # Check roles. "admin" remains accepted only for existing accounts; all
    # newly created privileged accounts use the explicit super_admin role.
    valid_roles = VALID_ROLES - {"admin"}
    if user_in.role not in valid_roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role. Must be one of {valid_roles}"
        )
        
    password_hash = get_password_hash(user_in.password)
    # HostelDetails validation normalizes hostel names while preserving assignments.
    user_dict = user_in.model_dump()
    user_dict.pop("password")
    fingerprint_enrollment = user_dict.pop("fingerprint_enrollment", None)
    user_dict["password_hash"] = password_hash
    # Ensure optional fields are removed when empty to keep DB clean
    if not user_dict.get("hostel_details"):
        user_dict.pop("hostel_details", None)
    if is_department_admin(current_user):
        if user_in.role not in DEPARTMENT_ADMIN_MANAGED_ROLES:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Department admins can create only student, advisor, and HOD users",
            )
        if not current_user.department:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Department admin has no assigned department")
        # The server is authoritative: a department admin can never submit a
        # user into a different department, even with a handcrafted request.
        user_dict["department"] = current_user.department
    if not user_dict.get("roll_number"):
        user_dict.pop("roll_number", None)

    if fingerprint_enrollment:
        # Store only the encrypted PID payload. Public API models and audit
        # trails intentionally do not reveal this record.
        user_dict["fingerprint_enrollment"] = {
            "provider": fingerprint_enrollment["provider"],
            "pid_data_encrypted": encrypt_biometric_payload(fingerprint_enrollment["pid_data"]),
            "device_id": fingerprint_enrollment["device_id"],
            "device_model": fingerprint_enrollment["device_model"],
            "quality_score": fingerprint_enrollment.get("quality_score"),
            "captured_at": datetime.utcnow(),
        }
    
    result = await db.users.insert_one(user_dict)
    user_dict["_id"] = result.inserted_id
    
    # Log admin audit trail
    await log_admin_action(db, current_user, "CREATE_USER", "User", result.inserted_id, {}, user_dict)
    
    # The client does not need the uploaded image echoed back in this response.
    return user_response({**user_dict, "photo": None})


@router.post("/users/import-csv")
async def import_users_csv(
    file: UploadFile = File(...),
    current_user: UserResponse = Depends(RoleChecker(ADMIN_READ_ROLES)),
):
    """Create user accounts from a CSV using the same validation as normal enrollment."""
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please upload a .csv file")
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
        rows = list(csv.DictReader(io.StringIO(text)))
    except (UnicodeDecodeError, csv.Error) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid CSV file: {exc}")
    if not rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV file has no data rows")

    created = 0
    errors = []
    for row_number, row in enumerate(rows, start=2):
        try:
            role = (row.get("role") or "student").strip().lower()
            imported_department = (
                current_user.department
                if is_department_admin(current_user)
                else (row.get("department") or None)
            )
            user_in = UserCreate(
                name=(row.get("name") or "").strip(),
                email=(row.get("email") or "").strip().lower(),
                password=row.get("password") or "",
                role=role,
                department=imported_department,
                roll_number=(row.get("roll_number") or None),
                year=(row.get("year") or None),
                parent_email=(row.get("parent_email") or None),
                photo=(row.get("photo") or None),
            )
            if role not in VALID_ROLES - {"admin"}:
                raise ValueError("invalid role")
            if is_department_admin(current_user):
                if role not in DEPARTMENT_ADMIN_MANAGED_ROLES:
                    raise ValueError("department admin may import only students, advisors, and HODs")
            db = get_database()
            if await db.users.find_one({"$or": [{"email": user_in.email}, {"roll_number": user_in.roll_number}] if user_in.roll_number else [{"email": user_in.email}]}):
                raise ValueError("email or roll number already registered")
            user_dict = user_in.model_dump()
            user_dict.pop("password")
            user_dict["password_hash"] = get_password_hash(user_in.password)
            if not user_dict.get("hostel_details"):
                user_dict.pop("hostel_details", None)
            result = await db.users.insert_one(user_dict)
            user_dict["_id"] = result.inserted_id
            await log_admin_action(db, current_user, "IMPORT_USER", "User", result.inserted_id, {}, user_dict)
            created += 1
        except Exception as exc:
            errors.append({"row": row_number, "error": str(exc)})
    return {"created": created, "failed": len(errors), "errors": errors}

@router.get("/users", response_model=PaginatedResponse[UserResponse])
async def get_all_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    search: Optional[str] = Query(None, max_length=100),
    current_user: UserResponse = Depends(RoleChecker(ADMIN_READ_ROLES))
):
    db = get_database()
    query = {}
    if is_department_admin(current_user):
        query["department"] = current_user.department
    if search and search.strip():
        escaped_search = re.escape(search.strip())
        query["$or"] = [
            {"name": {"$regex": escaped_search, "$options": "i"}},
            {"email": {"$regex": escaped_search, "$options": "i"}},
            {"role": {"$regex": escaped_search, "$options": "i"}},
            {"department": {"$regex": escaped_search, "$options": "i"}},
            {"roll_number": {"$regex": escaped_search, "$options": "i"}},
            {"parent_email": {"$regex": escaped_search, "$options": "i"}},
            {"enrollment_status": {"$regex": escaped_search, "$options": "i"}},
        ]
    # Photos are stored as base64 in MongoDB. Excluding them here avoids
    # reading and serializing every image for a paginated list request.
    cursor = db.users.find(
        query,
        {"photo": 0, "password_hash": 0, "fingerprint_enrollment.pid_data_encrypted": 0},
    ).sort("name", 1).skip((page - 1) * page_size).limit(page_size)
    total, results = await asyncio.gather(
        db.users.count_documents(query),
        cursor.to_list(length=page_size),
    )
    
    # Extract student IDs to run a single optimized aggregation
    student_ids = [u["_id"] for u in results if u.get("role") == "student"]
    
    recent_outpasses = {}
    if student_ids:
        pipeline = [
            {"$match": {"student_id": {"$in": student_ids}}},
            {"$sort": {"student_id": 1, "created_at": -1}},
            {
                "$group": {
                    "_id": "$student_id",
                    "status": {"$first": "$status"}
                }
            }
        ]
        cursor_agg = db.outpasses.aggregate(pipeline)
        agg_results = await cursor_agg.to_list(length=len(student_ids))
        for res in agg_results:
            recent_outpasses[res["_id"]] = res["status"]
            
    user_responses = []
    for u in results:
        # Convert _id to string for mapping to id field
        u_dict = {**u, "id": str(u["_id"])}
        
        # If user is a student, compute live status and location condition
        if u.get("role") == "student":
            status_val = recent_outpasses.get(u["_id"])
            if status_val:
                u_dict["active_outpass_status"] = status_val
                if status_val == "Student Left":
                    u_dict["live_status"] = "Outside Campus"
                else:
                    u_dict["live_status"] = "Inside Campus"
            else:
                u_dict["live_status"] = "Inside Campus"
                u_dict["active_outpass_status"] = "No Outpasses"
                
        user_responses.append(user_response(u_dict))
        
    return build_page(user_responses, page, page_size, total)


@router.get("/users/{id}/photo")
async def get_user_photo(
    id: str,
    current_user: UserResponse = Depends(RoleChecker(ADMIN_READ_ROLES)),
):
    """Load a user's photo only when an admin opens that user's editor."""
    db = get_database()
    try:
        user_oid = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user ID format")

    user_doc = await db.users.find_one(
        {"_id": user_oid},
        {"photo": 1, "role": 1, "department": 1},
    )
    if not user_doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    ensure_department_admin_can_manage(current_user, user_doc)
    return {"photo": user_doc.get("photo")}

@router.get("/users/{id}/outpasses", response_model=PaginatedResponse[OutpassResponse])
async def get_student_outpass_history(
    id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    current_user: UserResponse = Depends(RoleChecker(ADMIN_READ_ROLES))
):
    db = get_database()
    try:
        student_oid = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user ID format")
        
    query = {"student_id": student_oid}
    if is_department_admin(current_user):
        query["department"] = current_user.department
    cursor = db.outpasses.find(query).sort("created_at", -1).skip((page - 1) * page_size).limit(page_size)
    total, results = await asyncio.gather(
        db.outpasses.count_documents(query),
        cursor.to_list(length=page_size),
    )
    return build_page([OutpassResponse(**op) for op in results], page, page_size, total)

@router.put("/users/{id}", response_model=UserResponse)
async def update_user(
    id: str,
    user_update: UserUpdate,
    current_user: UserResponse = Depends(RoleChecker(ADMIN_READ_ROLES))
):
    db = get_database()
    try:
        user_oid = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user ID format")
        
    old_user = await db.users.find_one({"_id": user_oid})
    if not old_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        
    submitted_data = user_update.model_dump(exclude_unset=True)
    clearable_fields = {"roll_number", "year", "parent_email", "hostel_details", "department", "photo"}
    invalid_null_fields = [
        key for key, value in submitted_data.items()
        if value is None and key not in clearable_fields
    ]
    if invalid_null_fields:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"These fields cannot be cleared: {', '.join(invalid_null_fields)}",
        )
    fields_to_unset = {key for key, value in submitted_data.items() if value is None}
    update_data = {key: value for key, value in submitted_data.items() if value is not None}
    fingerprint_enrollment = update_data.pop("fingerprint_enrollment", None)

    ensure_department_admin_can_manage(current_user, old_user, submitted_data)

    if "role" in update_data and update_data["role"] not in VALID_ROLES - {"admin"}:
        # Existing "admin" accounts are a compatibility alias for super
        # admins. They may be edited without silently changing their role,
        # but new legacy-admin assignments are not allowed.
        if not (update_data["role"] == "admin" and old_user.get("role") == "admin"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")
    resulting_role = update_data.get("role", old_user.get("role"))
    resulting_department = submitted_data.get("department", old_user.get("department"))
    if submitted_data.get("year") is not None and resulting_role not in {"student", "advisor"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="year can be updated only for a student or advisor",
        )
    resulting_year = submitted_data.get("year", old_user.get("year"))
    if resulting_role == "advisor" and resulting_year is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="year is required for an advisor",
        )
    if resulting_role in DEPARTMENT_SCOPED_ROLES and not resulting_department:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"department is required for the {resulting_role} role",
        )
    if resulting_role == "student" and old_user.get("role") != "student":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Create student accounts through the student enrollment form so an MFS110 fingerprint is captured",
        )
    if fingerprint_enrollment and resulting_role != "student":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="fingerprint enrollment can be updated only for a student",
        )
    remove_fingerprint_enrollment = (
        old_user.get("role") == "student" and resulting_role != "student"
    )
    remove_year = old_user.get("role") in {"student", "advisor"} and resulting_role not in {"student", "advisor"}

    if fingerprint_enrollment:
        # The raw PID XML is accepted only for this request, then encrypted
        # before it reaches MongoDB. Audit logging deliberately omits this
        # sensitive field.
        update_data["fingerprint_enrollment"] = {
            "provider": fingerprint_enrollment["provider"],
            "pid_data_encrypted": encrypt_biometric_payload(fingerprint_enrollment["pid_data"]),
            "device_id": fingerprint_enrollment["device_id"],
            "device_model": fingerprint_enrollment["device_model"],
            "quality_score": fingerprint_enrollment.get("quality_score"),
            "captured_at": datetime.utcnow(),
        }
    
    # Process password hashing if present
    if "password" in update_data:
        from app.core.security import get_password_hash
        update_data["password_hash"] = get_password_hash(update_data.pop("password"))
        
    if not update_data and not fields_to_unset:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No update parameters provided")
        
    # Generate new state prediction
    new_user_state = {**old_user, **update_data}
    for field in fields_to_unset:
        new_user_state.pop(field, None)
    if remove_fingerprint_enrollment:
        new_user_state.pop("fingerprint_enrollment", None)
    
    # Update user in DB
    database_update = {}
    if update_data:
        database_update["$set"] = update_data
    if fields_to_unset:
        database_update["$unset"] = {field: "" for field in fields_to_unset}
    if remove_fingerprint_enrollment:
        # A user that is no longer a student has no enrollment purpose for
        # retaining the biometric payload.
        database_update.setdefault("$unset", {})["fingerprint_enrollment"] = ""
    if remove_year:
        database_update.setdefault("$unset", {})["year"] = ""
    await db.users.update_one({"_id": user_oid}, database_update)
    
    # Log Audit Log
    await log_admin_action(db, current_user, "UPDATE_USER", "User", user_oid, old_user, new_user_state)
    
    updated_user = await db.users.find_one({"_id": user_oid})
    return user_response({**updated_user, "photo": None})

@router.put("/outpasses/{id}", response_model=OutpassResponse)
async def update_outpass(
    id: str,
    outpass_update: AdminOutpassUpdate,
    current_user: UserResponse = Depends(RoleChecker(SUPER_ADMIN_ROLE_LIST))
):
    db = get_database()
    try:
        outpass_oid = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid outpass ID format")
        
    old_outpass = await db.outpasses.find_one({"_id": outpass_oid})
    if not old_outpass:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Outpass not found")
        
    update_data = outpass_update.model_dump(exclude_unset=True)
    if not update_data or any(value is None for value in update_data.values()):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields provided for update")
        
    new_outpass_state = {**old_outpass, **update_data}
    if new_outpass_state.get("in_date") and new_outpass_state.get("out_date"):
        if new_outpass_state["in_date"] <= new_outpass_state["out_date"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="in_date must be after out_date")
    
    await db.outpasses.update_one({"_id": outpass_oid}, {"$set": update_data})
    
    # Log Audit Log
    await log_admin_action(db, current_user, "UPDATE_OUTPASS", "Outpass", outpass_oid, old_outpass, new_outpass_state)
    
    updated_outpass = await db.outpasses.find_one({"_id": outpass_oid})
    return OutpassResponse(**updated_outpass)

@router.get("/audit-logs", response_model=PaginatedResponse[AuditLogResponse])
async def get_audit_logs(
    action: Optional[str] = None,
    search: Optional[str] = Query(None, max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    current_user: UserResponse = Depends(RoleChecker(ADMIN_READ_ROLES))
):
    db = get_database()
    query = {}
    if is_department_admin(current_user):
        # Historical audit records are not consistently tagged with the
        # target department, so expose only this admin's own actions.
        query["actor_id"] = ObjectId(current_user.id)
    if action:
        query["action"] = action
    if search and search.strip():
        escaped_search = re.escape(search.strip())
        query["$or"] = [
            {"actor_name": {"$regex": escaped_search, "$options": "i"}},
            {"action": {"$regex": escaped_search, "$options": "i"}},
            {"affected_model": {"$regex": escaped_search, "$options": "i"}},
            {"affected_id": {"$regex": escaped_search, "$options": "i"}},
        ]
        
    cursor = db.audit_logs.find(
        query,
        {
            "changes.photo": 0,
            "changes.password": 0,
            "changes.password_hash": 0,
            "changes.fingerprint_enrollment": 0,
        },
    ).sort("timestamp", -1).skip((page - 1) * page_size).limit(page_size)
    total, results = await asyncio.gather(
        db.audit_logs.count_documents(query),
        cursor.to_list(length=page_size),
    )
    sanitized = []
    for log in results:
        log["changes"] = {
            field: value
            for field, value in log.get("changes", {}).items()
            if field not in SENSITIVE_AUDIT_FIELDS
        }
        sanitized.append(serialize_value(log))
    return build_page([AuditLogResponse(**log) for log in sanitized], page, page_size, total)

@router.post("/rollback/{audit_log_id}")
async def rollback_changes(
    audit_log_id: str,
    current_user: UserResponse = Depends(RoleChecker(SUPER_ADMIN_ROLE_LIST))
):
    db = get_database()
    try:
        log_oid = ObjectId(audit_log_id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Audit Log ID format")
        
    audit_log = await db.audit_logs.find_one({"_id": log_oid})
    if not audit_log:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit Log not found")
        
    model = audit_log["affected_model"]
    affected_id = audit_log["affected_id"]
    changes = {
        field: values
        for field, values in audit_log.get("changes", {}).items()
        if field not in SENSITIVE_AUDIT_FIELDS
    }
    
    # Prepare the rollback state (reverting fields to their 'old' values)
    rollback_data = {}
    for field, vals in changes.items():
        # vals is a list [old_value, new_value]
        # We restore the old_value (vals[0])
        rollback_data[field] = vals[0]
        
    if not rollback_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No changes found in audit log to rollback")
        
    if model == "User":
        old_user = await db.users.find_one({"_id": affected_id})
        if not old_user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target User for rollback no longer exists")
        
        new_state = {**old_user, **rollback_data}
        await db.users.update_one({"_id": affected_id}, {"$set": rollback_data})
        
        # Log the rollback itself
        await log_admin_action(db, current_user, "ROLLBACK", "User", affected_id, old_user, new_state)
        
    elif model == "Outpass":
        old_outpass = await db.outpasses.find_one({"_id": affected_id})
        if not old_outpass:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target Outpass for rollback no longer exists")
            
        # Re-parse datetimes if rollback involves dates
        for date_field in ["out_date", "in_date", "exit_time", "entry_time"]:
            if date_field in rollback_data and isinstance(rollback_data[date_field], str):
                try:
                    rollback_data[date_field] = datetime.fromisoformat(rollback_data[date_field].replace("Z", "+00:00"))
                except ValueError:
                    pass
                    
        new_state = {**old_outpass, **rollback_data}
        await db.outpasses.update_one({"_id": affected_id}, {"$set": rollback_data})
        
        # Log the rollback itself
        await log_admin_action(db, current_user, "ROLLBACK", "Outpass", affected_id, old_outpass, new_state)
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Rollback unsupported for model: {model}")
        
    return {"message": "Rollback executed successfully", "affected_model": model, "affected_id": str(affected_id)}

@router.delete("/users/{id}", status_code=status.HTTP_200_OK)
async def delete_user(
    id: str,
    current_user: UserResponse = Depends(RoleChecker(ADMIN_READ_ROLES))
):
    db = get_database()
    try:
        user_oid = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user ID format")
        
    old_user = await db.users.find_one({"_id": user_oid})
    if not old_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        
    ensure_department_admin_can_manage(current_user, old_user)

    # Prevent self-deletion
    if str(old_user["_id"]) == str(current_user.id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Administrators cannot delete their own accounts")
        
    # Delete the user
    await db.users.delete_one({"_id": user_oid})
    
    # Log admin audit trail
    await log_admin_action(db, current_user, "DELETE_USER", "User", user_oid, old_user, {})
    
    return {"message": "User deleted successfully", "id": id}

@router.get("/outpasses", response_model=PaginatedResponse[OutpassResponse])
async def get_all_outpasses(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    search: Optional[str] = Query(None, max_length=100),
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: UserResponse = Depends(RoleChecker(ADMIN_READ_ROLES))
):
    db = get_database()
    query = {}
    if is_department_admin(current_user):
        query["department"] = current_user.department
    if status_filter:
        query["status"] = status_filter
    if search and search.strip():
        escaped_search = re.escape(search.strip())
        query["$or"] = [
            {"student_name": {"$regex": escaped_search, "$options": "i"}},
            {"roll_number": {"$regex": escaped_search, "$options": "i"}},
            {"destination": {"$regex": escaped_search, "$options": "i"}},
            {"status": {"$regex": escaped_search, "$options": "i"}},
        ]
    cursor = db.outpasses.find(query).sort("created_at", -1).skip((page - 1) * page_size).limit(page_size)
    total, results = await asyncio.gather(
        db.outpasses.count_documents(query),
        cursor.to_list(length=page_size),
    )
    return build_page([OutpassResponse(**op) for op in results], page, page_size, total)

@router.delete("/outpasses/{id}", status_code=status.HTTP_200_OK)
async def delete_outpass(
    id: str,
    current_user: UserResponse = Depends(RoleChecker(SUPER_ADMIN_ROLE_LIST))
):
    db = get_database()
    try:
        outpass_oid = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid outpass ID format")
        
    old_outpass = await db.outpasses.find_one({"_id": outpass_oid})
    if not old_outpass:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Outpass not found")
        
    # Delete outpass
    await db.outpasses.delete_one({"_id": outpass_oid})
    
    # Log admin audit trail
    await log_admin_action(db, current_user, "DELETE_OUTPASS", "Outpass", outpass_oid, old_outpass, {})
    
    return {"message": "Outpass record deleted successfully", "id": id}


class SMTPSettingsUpdate(BaseModel):
    smtp_host: str = Field(..., json_schema_extra={"example": "smtp.gmail.com"})
    smtp_port: int = Field(..., json_schema_extra={"example": 587})
    smtp_user: str = Field(..., json_schema_extra={"example": "user@gmail.com"})
    smtp_password: Optional[str] = Field(None, json_schema_extra={"example": "mypassword"})
    email_from: str = Field(..., json_schema_extra={"example": "user@gmail.com"})
    is_enabled: bool = True
    redirect_to_sender: bool = False


@router.get("/settings/smtp")
async def get_smtp_settings(current_user: UserResponse = Depends(RoleChecker(SUPER_ADMIN_ROLE_LIST))):
    db = get_database()
    config = await db.system_settings.find_one({"_id": "smtp"})
    if not config:
        return {
            "smtp_host": settings.SMTP_HOST or "",
            "smtp_port": settings.SMTP_PORT or 587,
            "smtp_user": settings.SMTP_USER or "",
            "has_password": bool(settings.SMTP_PASSWORD),
            "email_from": settings.EMAIL_FROM or "",
            "is_enabled": True,
            "redirect_to_sender": False
        }
    
    return {
        "smtp_host": config.get("smtp_host", ""),
        "smtp_port": config.get("smtp_port", 587),
        "smtp_user": config.get("smtp_user", ""),
        "has_password": bool(config.get("smtp_password")),
        "email_from": config.get("email_from", ""),
        "is_enabled": config.get("is_enabled", True),
        "redirect_to_sender": config.get("redirect_to_sender", False)
    }


@router.put("/settings/smtp")
async def update_smtp_settings(
    payload: SMTPSettingsUpdate,
    current_user: UserResponse = Depends(RoleChecker(SUPER_ADMIN_ROLE_LIST))
):
    db = get_database()
    existing = await db.system_settings.find_one({"_id": "smtp"})
    
    update_dict = {
        "smtp_host": payload.smtp_host,
        "smtp_port": payload.smtp_port,
        "smtp_user": payload.smtp_user,
        "email_from": payload.email_from,
        "is_enabled": payload.is_enabled,
        "redirect_to_sender": payload.redirect_to_sender
    }
    
    if payload.smtp_password is not None:
        if payload.smtp_password.strip() != "" and payload.smtp_password != "********":
            update_dict["smtp_password"] = payload.smtp_password
    elif existing and "smtp_password" in existing:
        update_dict["smtp_password"] = existing["smtp_password"]
        
    await db.system_settings.update_one(
        {"_id": "smtp"},
        {"$set": update_dict},
        upsert=True
    )
    
    # Log this configuration action in audit logs
    old_state = existing or {}
    new_state = {**old_state, **update_dict}
    # Avoid recording cleartext password in database audit log
    if "smtp_password" in old_state:
        old_state = {**old_state, "smtp_password": "********"}
    if "smtp_password" in new_state:
        new_state = {**new_state, "smtp_password": "********"}
    await log_admin_action(db, current_user, "UPDATE_SMTP_SETTINGS", "SystemSettings", "smtp", old_state, new_state)
    
    return {"message": "SMTP Settings updated successfully."}
