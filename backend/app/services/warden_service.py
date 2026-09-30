from app.core.database import get_database
from app.core.hostels import hostel_name_filter, normalize_hostel_name
from bson import ObjectId

async def get_warden_summary(warden_id: str):
    """Return summary for a warden: hostel name, capacity, resident count.
    Assumes a Hostel document has a `warden_id` field referencing the User _id.
    """
    db = get_database()
    warden_obj_id = ObjectId(warden_id)
    hostel = await db.hostels.find_one({"warden_id": warden_obj_id})
    warden = await db.users.find_one(
        {"_id": warden_obj_id},
        {"hostel_details.hostel_name": 1},
    )
    profile_hostel = (
        warden.get("hostel_details", {}).get("hostel_name")
        if warden
        else None
    )
    hostel_name = (
        normalize_hostel_name(hostel.get("name")) if hostel else None
    ) or normalize_hostel_name(profile_hostel)
    if not hostel_name:
        return {"hostel_name": None, "capacity": 0, "resident_count": 0}
    capacity = hostel.get("capacity", 0) if hostel else 0
    hostel_filter = hostel_name_filter(hostel_name)
    # Count students whose hostel_details.hostel_name matches
    resident_count = await db.users.count_documents({
        "role": "student",
        "hostel_details.hostel_name": hostel_filter
    })
    return {
        "hostel_name": hostel_name,
        "capacity": capacity,
        "resident_count": resident_count,
    }
