import os
import sys
from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

load_dotenv()

_SECRET_KEY = os.getenv("SECRET_KEY")
if not _SECRET_KEY:
    sys.exit(
        "FATAL: SECRET_KEY environment variable is not set. "
        "Refusing to start with a default/hardcoded signing key. "
        "Set SECRET_KEY in your environment or .env file (see .env.example)."
    )

class Settings(BaseSettings):
    MONGODB_URI: str = os.getenv("MONGODB_URI", "mongodb://localhost:27017/homs")
    DATABASE_NAME: str = os.getenv("DATABASE_NAME", "homs")
    FRONTEND_ORIGINS: str = os.getenv("FRONTEND_ORIGINS", "")
    SECRET_KEY: str = _SECRET_KEY
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))
    # Optional dedicated key for biometric encryption (see services/biometric.py)
    BIOMETRIC_ENCRYPTION_KEY: str = os.getenv("BIOMETRIC_ENCRYPTION_KEY", "")
    # Gate EXIT scans are allowed this many minutes before out_date
    GATE_EXIT_EARLY_GRACE_MINUTES: int = int(os.getenv("GATE_EXIT_EARLY_GRACE_MINUTES", "30"))
    # Login throttling
    LOGIN_MAX_ATTEMPTS: int = int(os.getenv("LOGIN_MAX_ATTEMPTS", "5"))
    LOGIN_LOCKOUT_SECONDS: int = int(os.getenv("LOGIN_LOCKOUT_SECONDS", "900"))

    # SMTP Configuration for Nodemailer-like alerts
    SMTP_HOST: str = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER: str = os.getenv("SMTP_USER", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")  # Secure Google App Password
    EMAIL_FROM: str = os.getenv("EMAIL_FROM", "homs-alerts@college.edu")

    model_config = SettingsConfigDict(env_file=".env", extra="allow")

settings = Settings()
