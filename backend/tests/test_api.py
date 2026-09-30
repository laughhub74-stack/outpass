import pytest
import pytest_asyncio
import asyncio
from datetime import datetime, timedelta
from httpx import AsyncClient, ASGITransport
from bson import ObjectId
from app.main import app
from app.core.database import get_database, connect_to_mongo, close_mongo_connection
from app.core.security import get_password_hash

async def _mongo_available() -> bool:
    from motor.motor_asyncio import AsyncIOMotorClient
    from app.core.config import settings
    client = AsyncIOMotorClient(settings.MONGODB_URI, serverSelectionTimeoutMS=1500)
    try:
        await client.admin.command("ping")
        return True
    except Exception:
        return False
    finally:
        client.close()


@pytest_asyncio.fixture(autouse=True)
async def test_db_setup():
    # Integration tests need a live MongoDB (set MONGODB_URI, uses DATABASE_NAME=homs_test).
    if not await _mongo_available():
        pytest.skip("MongoDB is not reachable; skipping integration tests")
    await connect_to_mongo()
    db = get_database()

    await db.users.delete_many({})
    await db.outpasses.delete_many({})
    await db.audit_logs.delete_many({})
    yield
    await close_mongo_connection()

@pytest.mark.asyncio
async def test_full_system_flow():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        fingerprint_enrollment = {
            "provider": "mantra_mfs110",
            "pid_data": "<PidData><Resp errCode=\"0\" errInfo=\"Success\"/><Skey ci=\"20260826\">encrypted-key-material</Skey><Hmac>encrypted-hmac-material</Hmac><Data type=\"X\">encrypted-fingerprint-material</Data></PidData>",
            "device_id": "test-device-code",
            "device_model": "MFS110",
            "quality_score": 82,
        }
        # 1. Register users for all required workflow roles
        roles = {
            "student": {"name": "Alice Student", "email": "alice@student.com", "role": "student", "department": "CSE", "roll_number": "STU101", "year": 1, "parent_email": "parent@alice.com", "password": "password123"},
            "advisor": {"name": "Bob Advisor", "email": "bob@faculty.com", "role": "advisor", "department": "CSE", "year": 1, "password": "password123"},
            "other_department_advisor": {"name": "AI advisor", "email": "ai-advisor@faculty.com", "role": "advisor", "department": "AI&ML", "year": 1, "password": "password123"},
            "other_year_advisor": {"name": "CSE Year Two advisor", "email": "cse-year-two@faculty.com", "role": "advisor", "department": "CSE", "year": 2, "password": "password123"},
            "warden": {"name": "Charlie Warden", "email": "charlie@hostel.com", "role": "warden", "password": "password123"},
            "hod": {"name": "Dave HOD", "email": "dave@department.com", "role": "hod", "department": "CSE", "password": "password123"},
            "security": {"name": "Sam Security", "email": "sam@gate.com", "role": "security", "password": "password123"},
            "super_admin": {"name": "Arthur Admin", "email": "arthur@admin.com", "role": "super_admin", "password": "password123"},
            "department_admin": {"name": "CSE Admin", "email": "cse-admin@college.com", "role": "department_admin", "department": "CSE", "password": "password123"},
        }
        
        db = get_database()
        tokens = {}
        for role_name, user_data in roles.items():
            user_doc = user_data.copy()
            pwd = user_doc.pop("password")
            user_doc["password_hash"] = get_password_hash(pwd)
            user_doc["enrollment_status"] = "active"
            await db.users.insert_one(user_doc)
            
            # Log in to get token
            login_data = {
                "username": user_data["email"],
                "password": pwd
            }
            login_response = await ac.post("/api/auth/login", data=login_data)
            assert login_response.status_code == 200
            tokens[role_name] = login_response.json()["access_token"]
            
        # Headers helpers
        headers_student = {"Authorization": f"Bearer {tokens['student']}"}
        headers_advisor = {"Authorization": f"Bearer {tokens['advisor']}"}
        headers_other_department_advisor = {"Authorization": f"Bearer {tokens['other_department_advisor']}"}
        headers_warden = {"Authorization": f"Bearer {tokens['warden']}"}
        headers_hod = {"Authorization": f"Bearer {tokens['hod']}"}
        headers_security = {"Authorization": f"Bearer {tokens['security']}"}
        headers_admin = {"Authorization": f"Bearer {tokens['super_admin']}"}
        headers_department_admin = {"Authorization": f"Bearer {tokens['department_admin']}"}

        # Fingerprint enrollment is optional at account-creation time.
        missing_fingerprint_res = await ac.post(
            "/api/admin/users",
            json={
                "name": "Missing Fingerprint", "email": "missing-print@student.com", "password": "password123",
                "role": "student", "department": "CSE", "roll_number": "STU100",
            },
            headers=headers_admin,
        )
        assert missing_fingerprint_res.status_code == 201
        assert missing_fingerprint_res.json()["fingerprint_enrolled"] is False
        missing_fingerprint_doc = await db.users.find_one({"email": "missing-print@student.com"})
        assert "fingerprint_enrollment" not in missing_fingerprint_doc

        advisor_without_year_res = await ac.post(
            "/api/admin/users",
            json={
                "name": "Advisor Without Year",
                "email": "advisor-without-year@faculty.com",
                "password": "password123",
                "role": "advisor",
                "department": "CSE",
            },
            headers=headers_admin,
        )
        assert advisor_without_year_res.status_code == 422

        enrolled_student_res = await ac.post(
            "/api/admin/users",
            json={
                "name": "Enrolled Student", "email": "enrolled@student.com", "password": "password123",
                "role": "student", "department": "CSE", "roll_number": "STU099",
                "fingerprint_enrollment": fingerprint_enrollment,
            },
            headers=headers_admin,
        )
        assert enrolled_student_res.status_code == 201
        assert enrolled_student_res.json()["fingerprint_enrolled"] is True
        assert "fingerprint_enrollment" not in enrolled_student_res.json()
        enrolled_doc = await db.users.find_one({"email": "enrolled@student.com"})
        assert enrolled_doc["fingerprint_enrollment"]["pid_data_encrypted"] != fingerprint_enrollment["pid_data"]
        assert "pid_data" not in enrolled_doc["fingerprint_enrollment"]

        # 2. Student applies for outpass
        window_start = datetime.utcnow() + timedelta(minutes=1)
        outpass_data = {
            "destination": "City Center mall",
            "reason": "Purchase books and check health",
            "out_date": window_start.isoformat(),
            "in_date": (window_start + timedelta(hours=8)).isoformat(),
        }

        # Invalid time windows are rejected
        bad_order = {**outpass_data, "in_date": (window_start - timedelta(hours=1)).isoformat()}
        assert (await ac.post("/api/outpass/apply", json=bad_order, headers=headers_student)).status_code == 422
        in_past = {
            **outpass_data,
            "out_date": (datetime.utcnow() - timedelta(days=1)).isoformat(),
            "in_date": (datetime.utcnow() + timedelta(hours=1)).isoformat(),
        }
        assert (await ac.post("/api/outpass/apply", json=in_past, headers=headers_student)).status_code == 422
        
        apply_res = await ac.post("/api/outpass/apply", json=outpass_data, headers=headers_student)
        assert apply_res.status_code == 201
        outpass_id = apply_res.json()["id"]
        assert apply_res.json()["status"] == "Pending"
        pending_outpass_doc = await db.outpasses.find_one({"_id": ObjectId(outpass_id)})
        assert "qr_token" not in pending_outpass_doc

        year_two_student_id = ObjectId()
        await db.users.insert_one({
            "_id": year_two_student_id,
            "name": "CSE Year Two Student",
            "email": "cse-year-two@student.com",
            "role": "student",
            "department": "CSE",
            "year": 2,
            "roll_number": "CSE201",
            "password_hash": get_password_hash("password123"),
            "enrollment_status": "active",
        })
        now = datetime.utcnow()
        year_two_outpass_result = await db.outpasses.insert_one({
            "student_id": year_two_student_id,
            "student_name": "CSE Year Two Student",
            "roll_number": "CSE201",
            "department": "CSE",
            "year": 2,
            "status": "Pending",
            "destination": "City Center",
            "reason": "Purchase books",
            "out_date": now + timedelta(days=1),
            "in_date": now + timedelta(days=1, hours=8),
            "created_at": now,
        })
        advisor_pending_res = await ac.get("/api/outpass/pending", headers=headers_advisor)
        assert advisor_pending_res.status_code == 200
        assert [item["id"] for item in advisor_pending_res.json()["items"]] == [outpass_id]
        advisor_own_pending_res = await ac.get(
            "/api/outpass/my-requests",
            params={"status": "Pending"},
            headers=headers_advisor,
        )
        assert advisor_own_pending_res.status_code == 200
        assert [item["id"] for item in advisor_own_pending_res.json()["items"]] == [outpass_id]

        wrong_year_res = await ac.post(
            f"/api/outpass/{outpass_id}/approve",
            json={"comments": "Different year"},
            headers={"Authorization": "Bearer " + tokens["other_year_advisor"]},
        )
        assert wrong_year_res.status_code == 403

        # A department-scoped advisor cannot access a student's request from
        # another department, even if they construct the approval URL.
        wrong_department_res = await ac.post(
            f"/api/outpass/{outpass_id}/approve", json={"comments": "Not my student"}, headers=headers_other_department_advisor
        )
        assert wrong_department_res.status_code == 403

        # 3. Test non-bypassable sequence (Warden trying to approve before Advisor and HOD)
        warden_fail_res = await ac.post(f"/api/outpass/{outpass_id}/approve", json={"comments": "Looks fine"}, headers=headers_warden)
        assert warden_fail_res.status_code == 400
        assert "Warden can only approve 'HOD Approved'" in warden_fail_res.json()["detail"]

        # 4. Advisor approves
        adv_res = await ac.post(f"/api/outpass/{outpass_id}/approve", json={"comments": "Checked marks"}, headers=headers_advisor)
        assert adv_res.status_code == 200
        assert adv_res.json()["status"] == "Advisor Approved"
        await db.outpasses.update_one(
            {"_id": year_two_outpass_result.inserted_id},
            {"$set": {"status": "Advisor Approved"}},
        )
        advisor_history_res = await ac.get(
            "/api/outpass/my-requests",
            params={"history_only": True},
            headers=headers_advisor,
        )
        assert advisor_history_res.status_code == 200
        assert [item["id"] for item in advisor_history_res.json()["items"]] == [outpass_id]

        # 5. Warden cannot bypass the HOD stage
        warden_second_fail_res = await ac.post(f"/api/outpass/{outpass_id}/approve", json={"comments": "Proceed"}, headers=headers_warden)
        assert warden_second_fail_res.status_code == 400
        assert "Warden can only approve 'HOD Approved'" in warden_second_fail_res.json()["detail"]

        # 6. HOD approves after the advisor
        hod_res = await ac.post(f"/api/outpass/{outpass_id}/approve", json={"comments": "Proceed"}, headers=headers_hod)
        assert hod_res.status_code == 200
        assert hod_res.json()["status"] == "HOD Approved"
        assert hod_res.json()["qr_token"] is None

        # 7. Warden gives final approval (generates QR Token for security)
        warden_res = await ac.post(f"/api/outpass/{outpass_id}/approve", json={"comments": "Enjoy your break"}, headers=headers_warden)
        assert warden_res.status_code == 200
        assert warden_res.json()["status"] == "Approved"
        qr_token = warden_res.json()["qr_token"]
        assert qr_token is not None

        # 8. Test Gate EXIT marking
        exit_res = await ac.post("/api/outpass/mark-gate", json={"outpassId": qr_token, "action": "EXIT"}, headers=headers_security)
        assert exit_res.status_code == 200
        assert exit_res.json()["status"] == "Student Left"
        assert exit_res.json()["exit_time"] is not None

        # 9. Test Gate ENTRY marking
        entry_res = await ac.post("/api/outpass/mark-gate", json={"outpassId": outpass_id, "action": "ENTRY"}, headers=headers_security)
        assert entry_res.status_code == 200
        assert entry_res.json()["status"] == "Student Returned"
        assert entry_res.json()["entry_time"] is not None

        admin_users_res = await ac.get(
            "/api/admin/users",
            params={"page": 1, "page_size": 10},
            headers=headers_admin,
        )
        assert admin_users_res.status_code == 200
        alice_admin_view = next(
            user for user in admin_users_res.json()["items"]
            if user["id"] == apply_res.json()["student_id"]
        )
        assert alice_admin_view["active_outpass_status"] == "Student Returned"
        assert alice_admin_view["live_status"] == "Inside Campus"

        # 10. Test Admin user modification audit trails
        alice_user_id = apply_res.json()["student_id"]
        admin_update_res = await ac.put(
            f"/api/admin/users/{alice_user_id}",
            json={"name": "Alice Modified", "email": "alice_mod@student.com"},
            headers=headers_admin
        )
        assert admin_update_res.status_code == 200
        assert admin_update_res.json()["name"] == "Alice Modified"

        # Existing students can replace (or add, for legacy accounts) their
        # MFS110 enrollment from the edit form. Raw PID XML must never be
        # persisted or returned.
        fingerprint_update_res = await ac.put(
            f"/api/admin/users/{alice_user_id}",
            json={"fingerprint_enrollment": fingerprint_enrollment},
            headers=headers_admin,
        )
        assert fingerprint_update_res.status_code == 200
        assert fingerprint_update_res.json()["fingerprint_enrolled"] is True
        assert "fingerprint_enrollment" not in fingerprint_update_res.json()
        updated_alice_doc = await db.users.find_one({"_id": ObjectId(alice_user_id)})
        assert updated_alice_doc["fingerprint_enrollment"]["pid_data_encrypted"] != fingerprint_enrollment["pid_data"]
        assert "pid_data" not in updated_alice_doc["fingerprint_enrollment"]

        # 11. Fetch Audit Logs
        audit_res = await ac.get("/api/admin/audit-logs", headers=headers_admin)
        assert audit_res.status_code == 200
        logs = audit_res.json()
        assert len(logs) > 0
        latest_log = logs[0]
        assert latest_log["action"] == "UPDATE_USER"
        assert "name" in latest_log["changes"]
        assert latest_log["changes"]["name"] == ["Alice Student", "Alice Modified"]

        # 12. Test Rollback
        rollback_res = await ac.post(f"/api/admin/rollback/{latest_log['id']}", headers=headers_admin)
        assert rollback_res.status_code == 200
        
        # Check student name reverted to Alice Student
        student_check = await ac.get("/api/auth/me", headers=headers_student)
        assert student_check.status_code == 200
        # Wait, Alice's token was generated using her old email address. It should still fetch because we authenticate on MongoDB ID (which doesn't change)!
        assert student_check.json()["name"] == "Alice Student"
        assert student_check.json()["email"] == "alice@student.com"

        # 13. Department admins can view every record, but may only CRUD
        # students/advisors/HODs from their own department.
        users_res = await ac.get("/api/admin/users", headers=headers_department_admin)
        assert users_res.status_code == 200
        assert len(users_res.json()) == len(roles) + 2  # Students created above.

        create_cse_student = await ac.post(
            "/api/admin/users",
            json={
                "name": "CSE Student Two", "email": "cse2@student.com", "password": "password123",
                "role": "student", "department": "AI&ML", "roll_number": "STU102",
                "fingerprint_enrollment": fingerprint_enrollment,
            },
            headers=headers_department_admin,
        )
        assert create_cse_student.status_code == 201
        assert create_cse_student.json()["department"] == "CSE"

        forbidden_role_create = await ac.post(
            "/api/admin/users",
            json={"name": "Other Security", "email": "other-security@college.com", "password": "password123", "role": "security"},
            headers=headers_department_admin,
        )
        assert forbidden_role_create.status_code == 403

        ai_student = {
            "name": "AI Student", "email": "ai@student.com", "role": "student", "department": "AI&ML",
            "roll_number": "AI101", "password_hash": get_password_hash("password123"), "enrollment_status": "active",
        }
        ai_result = await db.users.insert_one(ai_student)
        cross_department_update = await ac.put(
            f"/api/admin/users/{ai_result.inserted_id}", json={"name": "Not Allowed"}, headers=headers_department_admin
        )
        assert cross_department_update.status_code == 403

        department_outpass_write = await ac.put(
            f"/api/admin/outpasses/{outpass_id}", json={"destination": "Nope"}, headers=headers_department_admin
        )
        assert department_outpass_write.status_code == 403
