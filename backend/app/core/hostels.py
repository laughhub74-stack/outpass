import re
from typing import Any

from bson import ObjectId


def normalize_hostel_name(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = " ".join(value.split())
    return normalized or None


def hostel_name_filter(value: Any) -> dict | None:
    normalized = normalize_hostel_name(value)
    if not normalized:
        return None
    pattern = r"^\s*" + r"\s+".join(
        re.escape(part) for part in normalized.split()
    ) + r"\s*$"
    return {"$regex": pattern, "$options": "i"}


def hostel_names_match(first: Any, second: Any) -> bool:
    normalized_first = normalize_hostel_name(first)
    normalized_second = normalize_hostel_name(second)
    return bool(
        normalized_first
        and normalized_second
        and normalized_first.casefold() == normalized_second.casefold()
    )


def profile_hostel_name(user: Any) -> str | None:
    hostel_details = getattr(user, "hostel_details", None)
    if isinstance(hostel_details, dict):
        name = hostel_details.get("hostel_name")
    else:
        name = getattr(hostel_details, "hostel_name", None)
    return normalize_hostel_name(name)


async def get_assigned_hostel_name(db: Any, user: Any) -> str | None:
    hostel = await db.hostels.find_one(
        {"warden_id": ObjectId(user.id)},
        {"name": 1},
    )
    return (normalize_hostel_name(hostel.get("name")) if hostel else None) or profile_hostel_name(user)
