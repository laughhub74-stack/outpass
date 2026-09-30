from fastapi import APIRouter, Depends, HTTPException, status
from bson import ObjectId
from app.core.database import get_database
from app.core.hostels import get_assigned_hostel_name, hostel_name_filter
from app.routes.dependencies import RoleChecker, SUPER_ADMIN_ROLES
from typing import List

router = APIRouter(prefix="/api/warden", tags=["Warden Management"])

# Endpoint to get summary of hostels (name, capacity, resident count).
# Super admins can review the full list, while a warden sees only the hostel
# assigned to their account.
@router.get("/summary", response_model=List[dict])
async def get_hostel_summary(current_user: dict = Depends(RoleChecker([*SUPER_ADMIN_ROLES, "warden"]))):
    """Return a list of hostels with name, capacity, and current resident count."""
    db = get_database()
    summary_list = []

    if current_user.role == "warden":
        assigned_hostel_name = await get_assigned_hostel_name(db, current_user)
        if not assigned_hostel_name:
            return summary_list

        hostel = await db.hostels.find_one({"warden_id": ObjectId(current_user.id)})
        capacity = hostel.get("capacity", 0) if hostel else 0
        hostel_filter = hostel_name_filter(assigned_hostel_name)
        total_students = await db.users.count_documents({
            "role": "student",
            "hostel_details.hostel_name": hostel_filter,
        })
        student_ids = await db.users.distinct("_id", {
            "role": "student",
            "hostel_details.hostel_name": hostel_filter,
        })
        outside_student_ids = await db.outpasses.distinct("student_id", {
            "student_id": {"$in": student_ids},
            "status": "Student Left",
        })
        return [{
            "hostel_name": assigned_hostel_name,
            "capacity": capacity,
            "resident_count": max(0, total_students - len(outside_student_ids)),
            "total_students": total_students,
            "outside_count": len(outside_student_ids),
        }]

    hostels_cursor = db.hostels.find()
    hostels = await hostels_cursor.to_list(length=500)
    for hostel in hostels:
        hostel_name = hostel.get("name")
        capacity = hostel.get("capacity", 0)
        hostel_filter = hostel_name_filter(hostel_name)
        if not hostel_filter:
            continue
        total_students = await db.users.count_documents({
            "role": "student",
            "hostel_details.hostel_name": hostel_filter,
        })
        student_ids = await db.users.distinct("_id", {
            "role": "student",
            "hostel_details.hostel_name": hostel_filter,
        })
        outside_student_ids = await db.outpasses.distinct("student_id", {
            "student_id": {"$in": student_ids},
            "status": "Student Left",
        })
        summary_list.append({
            "hostel_name": hostel_name,
            "capacity": capacity,
            "resident_count": max(0, total_students - len(outside_student_ids)),
            "total_students": total_students,
            "outside_count": len(outside_student_ids),
        })
    return summary_list
