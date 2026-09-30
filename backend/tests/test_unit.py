"""Unit tests that need no database."""
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from app.core.rate_limit import LoginThrottle
from app.models.outpass import OutpassCreate
from app.models.user import UserUpdate
from app.services.biometric import decrypt_biometric_payload, encrypt_biometric_payload


def _payload(**overrides):
    start = datetime.utcnow() + timedelta(hours=1)
    data = {
        "destination": "City Center",
        "reason": "Buy books for class",
        "out_date": start,
        "in_date": start + timedelta(hours=6),
    }
    data.update(overrides)
    return data


def test_valid_outpass_window():
    assert OutpassCreate(**_payload()).in_date > datetime.utcnow()


def test_in_date_must_be_after_out_date():
    start = datetime.utcnow() + timedelta(hours=1)
    with pytest.raises(ValidationError):
        OutpassCreate(**_payload(out_date=start, in_date=start))
    with pytest.raises(ValidationError):
        OutpassCreate(**_payload(out_date=start, in_date=start - timedelta(hours=1)))


def test_out_date_cannot_be_in_the_past():
    past = datetime.utcnow() - timedelta(days=1)
    with pytest.raises(ValidationError):
        OutpassCreate(**_payload(out_date=past, in_date=past + timedelta(hours=2)))


def test_duration_cap():
    start = datetime.utcnow() + timedelta(hours=1)
    with pytest.raises(ValidationError):
        OutpassCreate(**_payload(out_date=start, in_date=start + timedelta(days=31)))


def test_aware_datetimes_are_normalised_to_naive_utc():
    start = datetime.now(timezone.utc) + timedelta(hours=1)
    op = OutpassCreate(**_payload(out_date=start, in_date=start + timedelta(hours=2)))
    assert op.out_date.tzinfo is None


def test_admin_password_update_enforces_minimum_length():
    with pytest.raises(ValidationError):
        UserUpdate(password="short")
    assert UserUpdate(password="long-enough-pw").password == "long-enough-pw"


def test_login_throttle_locks_and_resets():
    t = LoginThrottle(max_attempts=3, lockout_seconds=60)
    for _ in range(3):
        assert t.retry_after("k") == 0
        t.record_failure("k")
    assert t.retry_after("k") > 0
    t.reset("k")
    assert t.retry_after("k") == 0


def test_biometric_roundtrip():
    token = encrypt_biometric_payload("<PidData/>")
    assert token != "<PidData/>"
    assert decrypt_biometric_payload(token) == "<PidData/>"
