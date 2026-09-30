"""Helpers for protecting biometric payloads at rest.

The Mantra RD service returns encrypted PID XML. It is still sensitive data,
so this module adds application-level encryption before it is written to
MongoDB.

Key management
--------------
* Set ``BIOMETRIC_ENCRYPTION_KEY`` (a Fernet key) so the biometric key is
  independent of ``SECRET_KEY``: rotating the JWT secret no longer makes
  stored fingerprints unreadable, and a leaked JWT secret no longer exposes
  biometrics.
* Records written before this key existed were encrypted with a key derived
  from ``SECRET_KEY``. That legacy key is kept as a *decrypt-only* fallback so
  existing data stays readable.
* To rotate: put the new key first, keep the old one available via the legacy
  derivation or re-encrypt the records, then retire it.

Legal note: fingerprints are sensitive personal data (India's DPDP Act 2023).
Obtain explicit consent, collect only what is needed, and define a retention
and deletion policy before storing them.
"""

import base64
import hashlib
import logging

from cryptography.fernet import Fernet, MultiFernet

from app.core.config import settings

logger = logging.getLogger("homs_biometric")


def _legacy_cipher() -> Fernet:
    key_material = hashlib.sha256(
        f"{settings.SECRET_KEY}:homs-biometric-enrollment:v1".encode("utf-8")
    ).digest()
    return Fernet(base64.urlsafe_b64encode(key_material))


def _biometric_cipher() -> MultiFernet:
    ciphers = []
    if settings.BIOMETRIC_ENCRYPTION_KEY:
        ciphers.append(Fernet(settings.BIOMETRIC_ENCRYPTION_KEY.encode("utf-8")))
    else:
        logger.warning(
            "BIOMETRIC_ENCRYPTION_KEY is not set; falling back to a key derived from SECRET_KEY."
        )
    # Always last: used for decrypting records written with the legacy key.
    ciphers.append(_legacy_cipher())
    return MultiFernet(ciphers)


def encrypt_biometric_payload(payload: str) -> str:
    """Encrypt an RD-service PID payload for database storage."""
    return _biometric_cipher().encrypt(payload.encode("utf-8")).decode("utf-8")


def decrypt_biometric_payload(token: str) -> str:
    """Decrypt a stored payload (tries the dedicated key, then the legacy key)."""
    return _biometric_cipher().decrypt(token.encode("utf-8")).decode("utf-8")
