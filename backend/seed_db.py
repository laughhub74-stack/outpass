"""Create the initial HOMS super-administrator account."""

import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv

# Make the script independent of the directory it is launched from.
load_dotenv(Path(__file__).with_name(".env"))

from app.core.database import close_mongo_connection, connect_to_mongo, get_database
from app.core.security import get_password_hash


async def seed_database() -> None:
    # No defaults on purpose: a known default admin login is a backdoor.
    email = (os.getenv("SUPER_ADMIN_EMAIL") or "").strip().lower()
    password = os.getenv("SUPER_ADMIN_PASSWORD") or ""
    name = (os.getenv("SUPER_ADMIN_NAME") or "").strip()
    if not email or not password or not name:
        raise SystemExit(
            "SUPER_ADMIN_NAME, SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must all be set "
            "(see .env.example). Refusing to create an admin with default credentials."
        )
    if len(password) < 8 or password.lower() in {"password", "password123", "12345678", "admin123"}:
        raise SystemExit("SUPER_ADMIN_PASSWORD is too weak: use at least 8 characters and avoid common passwords.")

    await connect_to_mongo()
    try:
        db = get_database()
        result = await db.users.update_one(
            {"email": email},
            {
                "$setOnInsert": {
                    "name": name,
                    "email": email,
                    "role": "super_admin",
                    "password_hash": get_password_hash(password),
                    "enrollment_status": "active",
                }
            },
            upsert=True,
        )

        if result.upserted_id:
            print(f"Created super-admin account: {email}")
        else:
            print(f"Super-admin account already exists: {email}")

    finally:
        await close_mongo_connection()


if __name__ == "__main__":
    asyncio.run(seed_database())
