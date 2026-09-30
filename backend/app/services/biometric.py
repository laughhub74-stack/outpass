"""Helpers for protecting biometric payloads at rest.

The Mantra RD service returns encrypted PID XML. It is still sensitive data,
so this module adds application-level encryption before it is written to
MongoDB. The key is derived from the deployment's existing SECRET_KEY.
"""

import base64
import hashlib

from cryptography.fernet import Fernet

from app.core.config import settings


def _biometric_cipher() -> Fernet:
    key_material = hashlib.sha256(
        f"{settings.SECRET_KEY}:homs-biometric-enrollment:v1".encode("utf-8")
    ).digest()
    return Fernet(base64.urlsafe_b64encode(key_material))


def encrypt_biometric_payload(payload: str) -> str:
    """Encrypt an RD-service PID payload for database storage."""
    return _biometric_cipher().encrypt(payload.encode("utf-8")).decode("utf-8")
