import secrets
import logging
import re
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Query
from bson import ObjectId
from app.core.config import settings
from app.core.database import get_database
from app.core.hostels import find_warden_for_hostel, get_assigned_hostel_name, hostel_names_match, normalize_hostel_name
from app.models.user import UserResponse
from app.models.outpass import OutpassCreate, OutpassResponse, OutpassApprove, OutpassReject
from app.models.pagination import PaginatedResponse, build_page
from app.routes.dependencies import get_current_user, RoleChecker, get_requester_outpass_filter, SUPER_ADMIN_ROLES
from app.services.email import (
    send_approval_notification,
    send_submission_notification,
    send_rejection_notification,
    send_gate_movement_notification,
    send_intermediate_approval_notification
)
from app.services.excel import generate_daily_excel_report

logger = logging.getLogger("homs_outpass")
router = APIRouter(prefix="/api/outpass", tags=["Outpass Management"])


def _get_hostel_attr(hostel_details, attr_name: str) -> str:
    if not hostel_details:
        return "N/A"
    if isinstance(hostel_details, dict):
        value = hostel_details.get(attr_name, "N/A")
    else:
        value = getattr(hostel_details, attr_name, "N/A")
    if attr_name == "hostel_name":
        return normalize_hostel_name(value) or "N/A"
    return value

async def ensure_department_approver_access(outpass: dict, current_user: UserResponse, db) -> None:
    """Prevent approvers from reviewing passes outside their assigned scope."""
    if current_user.role == "warden":
        assigned_hostel = await get_assigned_hostel_name(db, current_user)
        if not assigned_hostel:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Warden account has no assigned hostel")
        if not hostel_names_match(outpass.get("hostel_name"), assigned_hostel):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can review outpasses only for your assigned hostel")
        return
    if current_user.role not in {"advisor", "hod"}:
        return
    if not current_user.department:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Approver account has no assigned department")
    if current_user.role == "advisor":
        if current_user.year is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Advisor account has no assigned year")
        student = await db.users.find_one(
            {"_id": outpass["student_id"], "role": "student"},
            {"department": 1, "year": 1},
        )
        if (
            not student
            or student.get("department") != current_user.department
            or student.get("year") != current_user.year
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can review outpasses only for students in your department and assigned year",
            )
        return
    if outpass.get("department") != current_user.department:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can review outpasses only for students in your department",
        )


async def get_advisor_scoped_page(db, query: dict, page: int, page_size: int, advisor: UserResponse):
    """Paginate advisor requests after matching the student's current department and year."""
    if not advisor.department or advisor.year is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Advisor account needs an assigned department and year",
        )
    pipeline = [
        {"$match": query},
        {
            "$lookup": {
                "from": "users",
                "localField": "student_id",
                "foreignField": "_id",
                "as": "student",
            }
        },
        {
            "$match": {
                "student": {
                    "$elemMatch": {
                        "role": "student",
                        "department": advisor.department,
                        "year": advisor.year,
                    }
                }
            }
        },
        {"$sort": {"created_at": -1}},
        {
            "$facet": {
                "items": [
                    {"$skip": (page - 1) * page_size},
                    {"$limit": page_size},
                    {"$project": {"student": 0}},
                ],
                "total": [{"$count": "count"}],
            }
        },
    ]
    pages = await db.outpasses.aggregate(pipeline).to_list(length=1)
    page_result = pages[0] if pages else {"items": [], "total": []}
    total = page_result["total"][0]["count"] if page_result["total"] else 0
    items = [OutpassResponse(**outpass) for outpass in page_result["items"]]
    return build_page(items, page, page_size, total)


@router.post("/apply", response_model=OutpassResponse, status_code=status.HTTP_201_CREATED)
async def apply_outpass(
    outpass_in: OutpassCreate,
    background_tasks: BackgroundTasks,
    current_user: UserResponse = Depends(RoleChecker(["student"]))
):
    db = get_database()
    
    # Check if there is already an active/pending outpass for this student
    existing_pending = await db.outpasses.find_one({
        "student_id": ObjectId(current_user.id),
        "status": {"$in": ["Pending", "Advisor Approved", "HOD Approved", "Warden Approved", "Approved", "Student Left"]}
    })
    if existing_pending:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have a pending or active outpass request"
        )
        
    outpass_dict = outpass_in.dict()
    outpass_dict["student_id"] = ObjectId(current_user.id)
    outpass_dict["student_name"] = current_user.name
    outpass_dict["roll_number"] = current_user.roll_number or "N/A"
    if not current_user.department:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Your account needs a department before you can apply for an outpass",
        )

    # Validate the department route before persisting anything, so a request
    # cannot be left stranded if the department does not yet have an advisor.
    advisor_user = await db.users.find_one({
        "role": "advisor",
        "department": current_user.department,
        "year": current_user.year,
        "enrollment_status": "active",
    })
    if not advisor_user:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"No active advisor is assigned to year {current_user.year} in the {current_user.department} department",
        )

    outpass_dict["department"] = current_user.department
    outpass_dict["room"] = _get_hostel_attr(current_user.hostel_details, "room")
    outpass_dict["hostel_name"] = _get_hostel_attr(current_user.hostel_details, "hostel_name")
    outpass_dict["status"] = "Pending"
    outpass_dict["rejection_reason"] = None
    outpass_dict["exit_time"] = None
    outpass_dict["entry_time"] = None
    outpass_dict["created_at"] = datetime.utcnow()
    
    # Initialize history
    outpass_dict["history"] = [{
        "status": "Pending",
        "updated_by": ObjectId(current_user.id),
        "updated_by_name": current_user.name,
        "updated_at": datetime.utcnow(),
        "comments": "Outpass submitted by student."
    }]
    
    result = await db.outpasses.insert_one(outpass_dict)
    outpass_dict["_id"] = result.inserted_id
    
    # Route to the already-validated advisor from this student's department.
    advisor_email = advisor_user["email"]

    # Emails are queued as a background task so the API responds immediately
    # instead of making the student wait on a live SMTP round-trip.
    async def _notify():
        try:
            await send_submission_notification(
                student_email=current_user.email,
                advisor_email=advisor_email,
                student_name=outpass_dict["student_name"],
                roll_number=outpass_dict["roll_number"],
                destination=outpass_dict["destination"],
                out_date=outpass_dict["out_date"].strftime("%Y-%m-%d %H:%M:%S") if isinstance(outpass_dict["out_date"], datetime) else str(outpass_dict["out_date"]),
                in_date=outpass_dict["in_date"].strftime("%Y-%m-%d %H:%M:%S") if isinstance(outpass_dict["in_date"], datetime) else str(outpass_dict["in_date"])
            )
        except Exception as e:
            logger.error(f"Failed to send submission outpass email: {str(e)}")

    background_tasks.add_task(_notify)

    return OutpassResponse(**outpass_dict)

@router.get("/my-requests", response_model=PaginatedResponse[OutpassResponse])
async def get_my_requests(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    history_only: bool = Query(False),
    status_filter: str | None = Query(None, alias="status", max_length=40),
    current_user: UserResponse = Depends(get_current_user),
):
    db = get_database()
    query = await get_requester_outpass_filter(db, current_user)
    status_conditions = []
    allowed_status_filter = query.pop("status", None)
    if allowed_status_filter:
        status_conditions.append({"status": allowed_status_filter})
    if history_only:
        current_pending_status = {
            "advisor": "Pending",
            "hod": "Advisor Approved",
            "warden": "HOD Approved",
        }.get(current_user.role)
        if current_pending_status:
            status_conditions.append({"status": {"$ne": current_pending_status}})
    if status_filter:
        if (
            isinstance(allowed_status_filter, dict)
            and "$in" in allowed_status_filter
            and status_filter not in allowed_status_filter["$in"]
        ):
            query["_id"] = None
        status_conditions.append({"status": status_filter})
    if len(status_conditions) == 1:
        query.update(status_conditions[0])
    elif status_conditions:
        query["$and"] = status_conditions
    if current_user.role == "advisor":
        return await get_advisor_scoped_page(db, query, page, page_size, current_user)
    total = await db.outpasses.count_documents(query)
    cursor = db.outpasses.find(query).sort("created_at", -1).skip((page - 1) * page_size).limit(page_size)
    results = await cursor.to_list(length=page_size)
    return build_page([OutpassResponse(**op) for op in results], page, page_size, total)

@router.get("/pending", response_model=PaginatedResponse[OutpassResponse])
async def get_pending_outpasses(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    current_user: UserResponse = Depends(get_current_user),
):
    db = get_database()
    query = await get_requester_outpass_filter(db, current_user)
    
    # Filter by specific pending status relevant to current user's review level
    if current_user.role == "advisor":
        query["status"] = "Pending"
    elif current_user.role == "hod":
        query["status"] = "Advisor Approved"
    elif current_user.role == "warden":
        query["status"] = "HOD Approved"
    elif current_user.role == "security":
        query["status"] = "Approved"

    if current_user.role == "advisor":
        return await get_advisor_scoped_page(db, query, page, page_size, current_user)
        
    total = await db.outpasses.count_documents(query)
    cursor = db.outpasses.find(query).sort("created_at", -1).skip((page - 1) * page_size).limit(page_size)
    results = await cursor.to_list(length=page_size)
    return build_page([OutpassResponse(**op) for op in results], page, page_size, total)


@router.get("/lookup", response_model=OutpassResponse)
async def lookup_active_outpass(
    token: str = Query(..., min_length=1, max_length=100),
    current_user: UserResponse = Depends(RoleChecker(["security", *SUPER_ADMIN_ROLES])),
):
    """Find an active pass by QR token, Mongo ID, or exact roll number."""
    lookup_value = token.strip()
    conditions = [
        {"qr_token": lookup_value},
        {"roll_number": {"$regex": f"^{re.escape(lookup_value)}$", "$options": "i"}},
    ]
    try:
        conditions.append({"_id": ObjectId(lookup_value)})
    except Exception:
        pass

    db = get_database()
    outpass = await db.outpasses.find_one(
        {
            "status": {"$in": ["Approved", "Student Left"]},
            "$or": conditions,
        },
        sort=[("created_at", -1)],
    )
    if not outpass:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active approved outpass matches that QR code or roll number.",
        )
    return OutpassResponse(**outpass)

@router.post("/{id}/approve", response_model=OutpassResponse)
async def approve_outpass(
    id: str,
    approve_data: OutpassApprove,
    background_tasks: BackgroundTasks,
    current_user: UserResponse = Depends(RoleChecker(["advisor", "hod", "warden"]))
):
    db = get_database()
    try:
        outpass_oid = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid outpass ID format")
        
    outpass = await db.outpasses.find_one({"_id": outpass_oid})
    if not outpass:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Outpass request not found")
    await ensure_department_approver_access(outpass, current_user, db)
        
    current_status = outpass["status"]
    new_status = None
    
    # Strict validation of sequence
    if current_user.role == "advisor":
        if current_status != "Pending":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Advisor can only approve 'Pending' outpasses")
        new_status = "Advisor Approved"
        
    elif current_user.role == "hod":
        if current_status != "Advisor Approved":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="HOD can only approve 'Advisor Approved' outpasses")
        new_status = "HOD Approved"
        
    elif current_user.role == "warden":
        if current_status != "HOD Approved":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Warden can only approve 'HOD Approved' outpasses")
        new_status = "Approved"
        
    if not new_status:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid status progression transition")
        
    update_fields = {
        "status": new_status,
    }
    
    # A QR token is issued only after the warden's final approval. HOD
    # approval must not create a pass that security can scan prematurely.
    qr_token = outpass.get("qr_token")
    if not qr_token and new_status == "Approved":
        qr_token = f"OUT-{secrets.token_hex(8).upper()}"
        update_fields["qr_token"] = qr_token
        
    history_item = {
        "status": new_status,
        "updated_by": ObjectId(current_user.id),
        "updated_by_name": current_user.name,
        "updated_at": datetime.utcnow(),
        "comments": approve_data.comments or f"Approved by {current_user.role}"
    }

    # Atomic guard: the status condition is part of the update filter itself,
    # so if two requests race, only the first one to reach Mongo can match
    # current_status and flip it. The second gets a null result instead of
    # silently double-applying the transition.
    updated_outpass = await db.outpasses.find_one_and_update(
        {"_id": outpass_oid, "status": current_status},
        {
            "$set": update_fields,
            "$push": {"history": history_item}
        },
        return_document=True
    )

    if not updated_outpass:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This outpass was already updated by another action. Please refresh."
        )
    

    if new_status in ["Advisor Approved", "HOD Approved"]:
        next_role = "hod" if new_status == "Advisor Approved" else "warden"
        if next_role == "hod":
            next_user = await db.users.find_one({
                "role": "hod",
                "enrollment_status": "active",
                "department": outpass.get("department"),
            })
        else:
            # Only the warden of this student's hostel is notified.
            next_user = await find_warden_for_hostel(db, outpass.get("hostel_name"))
        next_email = next_user.get("email") if next_user else None
        if not next_email:
            logger.warning(
                "No active %s found for outpass %s; skipping next-approver notification.",
                next_role, outpass["_id"],
            )

        async def _notify_next():
            if not next_email:
                return
            try:
                await send_intermediate_approval_notification(
                    next_approver_email=next_email,
                    next_approver_role=next_role,
                    student_name=outpass.get("student_name"),
                    roll_number=outpass.get("roll_number", "N/A"),
                    destination=outpass.get("destination"),
                    out_date=outpass.get("out_date").strftime("%Y-%m-%d %H:%M:%S") if isinstance(outpass.get("out_date"), datetime) else str(outpass.get("out_date")),
                    in_date=outpass.get("in_date").strftime("%Y-%m-%d %H:%M:%S") if isinstance(outpass.get("in_date"), datetime) else str(outpass.get("in_date"))
                )
            except Exception as e:
                logger.error(f"Failed to send intermediate approval email: {str(e)}")

        background_tasks.add_task(_notify_next)

    # If final approval (Warden), trigger Email Notifications
    if new_status == "Approved" and qr_token:
        student = await db.users.find_one({"_id": outpass["student_id"]})
        student_email = student.get("email") if student else None
        parent_email = student.get("parent_email") if student and student.get("parent_email") else student_email

        hod_user = await db.users.find_one({
            "role": "hod",
            "department": outpass.get("department"),
            "enrollment_status": "active",
        })
        hod_email = hod_user.get("email") if hod_user else None
        warden_email = current_user.email

        async def _notify_final():
            try:
                await send_approval_notification(
                    student_email=student_email,
                    parent_email=parent_email,
                    hod_email=hod_email,
                    warden_email=warden_email,
                    student_name=outpass.get("student_name"),
                    roll_number=outpass.get("roll_number", "N/A"),
                    destination=outpass.get("destination"),
                    out_date=outpass.get("out_date").strftime("%Y-%m-%d %H:%M:%S"),
                    in_date=outpass.get("in_date").strftime("%Y-%m-%d %H:%M:%S"),
                    qr_token=qr_token
                )
            except Exception as e:
                logger.error(f"Failed to send outpass approval emails: {str(e)}")

        background_tasks.add_task(_notify_final)

    return OutpassResponse(**updated_outpass)

@router.post("/{id}/reject", response_model=OutpassResponse)
async def reject_outpass(
    id: str,
    reject_data: OutpassReject,
    background_tasks: BackgroundTasks,
    current_user: UserResponse = Depends(RoleChecker(["advisor", "hod", "warden"]))
):
    db = get_database()
    try:
        outpass_oid = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid outpass ID format")
        
    outpass = await db.outpasses.find_one({"_id": outpass_oid})
    if not outpass:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Outpass request not found")
    await ensure_department_approver_access(outpass, current_user, db)
        
    # Check that it's in a status they can review
    current_status = outpass["status"]
    if current_user.role == "advisor" and current_status != "Pending":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Advisor can only reject 'Pending' requests")
    elif current_user.role == "hod" and current_status != "Advisor Approved":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="HOD can only reject 'Advisor Approved' requests")
    elif current_user.role == "warden" and current_status != "HOD Approved":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Warden can only reject 'HOD Approved' requests")
        
    history_item = {
        "status": "Rejected",
        "updated_by": ObjectId(current_user.id),
        "updated_by_name": current_user.name,
        "updated_at": datetime.utcnow(),
        "comments": f"Rejected by {current_user.role}: {reject_data.rejection_reason}"
    }
    
    updated_outpass = await db.outpasses.find_one_and_update(
        {"_id": outpass_oid, "status": current_status},
        {
            "$set": {
                "status": "Rejected",
                "rejection_reason": reject_data.rejection_reason
            },
            "$push": {"history": history_item}
        },
        return_document=True
    )

    if not updated_outpass:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This outpass was already updated by another action. Please refresh."
        )
    
    # Retrieve student email to notify them of rejection
    student = await db.users.find_one({"_id": outpass["student_id"]})
    student_email = student.get("email") if student else None

    async def _notify_rejection():
        try:
            await send_rejection_notification(
                student_email=student_email,
                student_name=outpass.get("student_name"),
                roll_number=outpass.get("roll_number", "N/A"),
                destination=outpass.get("destination"),
                rejected_by_role=current_user.role,
                rejection_reason=reject_data.rejection_reason
            )
        except Exception as e:
            logger.error(f"Failed to send rejection outpass email: {str(e)}")

    background_tasks.add_task(_notify_rejection)

    return OutpassResponse(**updated_outpass)

@router.post("/mark-gate", response_model=OutpassResponse)
async def mark_gate(
    payload: dict,
    background_tasks: BackgroundTasks,
    current_user: UserResponse = Depends(RoleChecker(["security", "super_admin", "admin"]))
):
    outpass_id = payload.get("outpassId")
    action = payload.get("action")
    
    if not outpass_id or action not in ["EXIT", "ENTRY"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="outpassId and action ('EXIT' or 'ENTRY') are required"
        )
        
    db = get_database()
    
    # Try finding by MongoDB ID or QR Token
    query_conditions = [{"qr_token": outpass_id}, {"_id": outpass_id}]
    try:
        query_conditions.append({"_id": ObjectId(outpass_id)})
    except Exception:
        pass
        
    outpass = await db.outpasses.find_one({"$or": query_conditions})
    if not outpass:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Outpass record not found")
        
    current_status = outpass["status"]
    history_item = None
    update_fields = {}
    
    if action == "EXIT":
        if current_status != "Approved":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot mark EXIT. Outpass status is: {current_status}. Must be Approved."
            )
        now = datetime.utcnow()
        out_date = outpass.get("out_date")
        in_date = outpass.get("in_date")
        if out_date and now < out_date - timedelta(minutes=settings.GATE_EXIT_EARLY_GRACE_MINUTES):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Outpass is not valid yet. Exit is allowed only from the approved out time.",
            )
        if in_date and now > in_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Outpass has expired. The approved time window has passed.",
            )
        update_fields["status"] = "Student Left"
        update_fields["exit_time"] = now
        history_item = {
            "status": "Student Left",
            "updated_by": ObjectId(current_user.id),
            "updated_by_name": current_user.name,
            "updated_at": datetime.utcnow(),
            "comments": "Gate EXIT scanned and recorded."
        }
    elif action == "ENTRY":
        if current_status != "Student Left":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot mark ENTRY. Outpass status is: {current_status}. Must be Student Left."
            )
        update_fields["status"] = "Student Returned"
        update_fields["entry_time"] = datetime.utcnow()
        history_item = {
            "status": "Student Returned",
            "updated_by": ObjectId(current_user.id),
            "updated_by_name": current_user.name,
            "updated_at": datetime.utcnow(),
            "comments": "Gate ENTRY scanned and recorded."
        }
        
    update_result = await db.outpasses.update_one(
        {"_id": outpass["_id"], "status": current_status},
        {
            "$set": update_fields,
            "$push": {"history": history_item}
        }
    )
    if update_result.matched_count != 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This outpass was already updated by another action. Please refresh.",
        )
    
    updated_outpass = await db.outpasses.find_one({"_id": outpass["_id"]})

    # Gate scans need to feel instant for the security guard. Regenerating
    # the Excel report (pandas file I/O) and sending the gate-movement email
    # used to be awaited here, which meant every single scan blocked on a
    # disk write plus a live SMTP round-trip before the UI could show a
    # result. Both now happen in the background after the response is sent.
    async def _post_gate_actions():
        try:
            await generate_daily_excel_report(datetime.utcnow())
        except Exception as e:
            logger.error(f"Failed to update Excel report on gate action: {str(e)}")

        student = await db.users.find_one({"_id": outpass["student_id"]})
        if student:
            student_email = student.get("email")
            parent_email = student.get("parent_email") if student.get("parent_email") else student_email
            direction = "OUT" if action == "EXIT" else "IN"
            timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S") + " UTC"
            try:
                await send_gate_movement_notification(
                    student_email=student_email,
                    parent_email=parent_email,
                    student_name=outpass.get("student_name"),
                    roll_number=outpass.get("roll_number", "N/A"),
                    destination=outpass.get("destination"),
                    direction=direction,
                    timestamp=timestamp
                )
            except Exception as e:
                logger.error(f"Failed to send gate movement outpass email: {str(e)}")

    background_tasks.add_task(_post_gate_actions)

    return OutpassResponse(**updated_outpass)
