import re
from typing import Any, Optional, Annotated, Literal
from bson import ObjectId
from pydantic import BaseModel, EmailStr, Field, BeforeValidator, PlainSerializer, WithJsonSchema, AliasChoices, field_validator, model_validator, ConfigDict

# Keep the department values in one place so API validation and the UI use the
# exact same identifiers.  These values are stored on students and the
# department-scoped staff who route their requests.
DEPARTMENTS = ("AI&ML", "AI&DS", "CSE", "ECE", "IT", "CS", "EEE", "CIVIL", "MECH")
DEPARTMENT_SCOPED_ROLES = {"student", "advisor", "hod", "department_admin"}
VALID_ROLES = {
    "student", "advisor", "warden", "hod", "security",
    "super_admin", "department_admin",
    # Existing deployments may still have this role. It is treated as a
    # super-admin compatibility alias by authorization checks.
    "admin",
}

PHOTO_DATA_URL_PATTERN = re.compile(
    r"^data:image/(?:jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=\s]+$",
    re.IGNORECASE,
)


def validate_photo(value: Optional[str]) -> Optional[str]:
    if value is None or value == "":
        return None
    photo = value.strip()
    if len(photo) > 7_000_000:
        raise ValueError("photo must be 5 MB or smaller")
    if not PHOTO_DATA_URL_PATTERN.fullmatch(photo):
        raise ValueError("photo must be a base64-encoded JPEG, PNG, WebP, or GIF image")
    return photo

# Custom type for handling MongoDB ObjectId
PyObjectId = Annotated[
    str,
    BeforeValidator(lambda x: str(x) if isinstance(x, ObjectId) else x),
    PlainSerializer(lambda x: str(x), return_type=str),
    WithJsonSchema({"type": "string", "example": "507f1f77bcf86cd799439011"}),
]


def coerce_student_year(value: Any) -> Any:
    """Accept year values stored as strings (common in Mongo imports and form posts)."""
    if value is None or value == "":
        return None
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        if stripped.isdigit():
            return int(stripped)
        return value
    if isinstance(value, bool):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


StudentYear = Annotated[Optional[Literal[1, 2, 3, 4]], BeforeValidator(coerce_student_year)]

class HostelDetails(BaseModel):
    room: str = Field(..., json_schema_extra={"example": "101"})
    hostel_name: str = Field(..., json_schema_extra={"example": "A-Block"})
    occupancy_status: str = Field("Resident", json_schema_extra={"example": "Resident"})

    @field_validator("hostel_name")
    @classmethod
    def normalize_hostel_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("hostel name must not be empty")
        return normalized


class FingerprintEnrollment(BaseModel):
    """A successful MFS110 RD-service capture used for student enrollment."""

    provider: Literal["mantra_mfs110"]
    pid_data: str = Field(..., min_length=80, max_length=100_000)
    device_id: str = Field(..., min_length=1, max_length=100)
    device_model: str = Field(..., min_length=1, max_length=100)
    quality_score: Optional[int] = Field(None, ge=0, le=100)

    @field_validator("pid_data")
    @classmethod
    def validate_pid_data(cls, value: str) -> str:
        payload = value.strip()
        # Avoid fully parsing untrusted XML. These are the required elements
        # from a successful RD response; doctypes/entities are rejected.
        if "<!" in payload or not all(marker in payload for marker in ("<PidData", "<Resp", "<Skey", "<Hmac", "<Data")):
            raise ValueError("fingerprint enrollment must contain a valid Mantra RD PID response")
        if not re.search(r"<Resp\b[^>]*\berrCode\s*=\s*['\"]0['\"]", payload, re.IGNORECASE):
            raise ValueError("fingerprint enrollment must be a successful Mantra RD capture")
        return payload

    @field_validator("device_model")
    @classmethod
    def validate_mfs110_model(cls, value: str) -> str:
        if "MFS110" not in value.upper():
            raise ValueError("fingerprint enrollment must be captured with an MFS110 scanner")
        return value

class UserBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=50)
    email: EmailStr
    role: str = Field("student", description="student, advisor, hod, warden, security, super_admin, department_admin")
    department: Optional[str] = None
    roll_number: Optional[str] = None
    year: StudentYear = None
    parent_email: Optional[EmailStr] = None
    hostel_details: Optional[HostelDetails] = None
    enrollment_status: str = "active"
    photo: Optional[str] = Field(default=None, max_length=7_000_000)

    @field_validator("photo")
    @classmethod
    def validate_photo_data(cls, value: Optional[str]) -> Optional[str]:
        return validate_photo(value)

    @field_validator("department")
    @classmethod
    def validate_department(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        department = value.strip()
        if not department:
            return None
        if department not in DEPARTMENTS:
            raise ValueError(f"Department must be one of: {', '.join(DEPARTMENTS)}")
        return department

class UserCreate(UserBase):
    password: str = Field(..., min_length=8, max_length=128)
    fingerprint_enrollment: Optional[FingerprintEnrollment] = None

    @model_validator(mode="after")
    def require_department_for_scoped_roles(self):
        if self.role in DEPARTMENT_SCOPED_ROLES and not self.department:
            raise ValueError(f"department is required for the {self.role} role")
        if self.role == "advisor" and self.year is None:
            raise ValueError("year is required for an advisor")
        if self.role not in {"student", "advisor"} and self.year is not None:
            raise ValueError("year can be provided only for a student or advisor")
        if self.role != "student" and self.fingerprint_enrollment:
            raise ValueError("fingerprint enrollment can be provided only for a student")
        return self

class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    roll_number: Optional[str] = None
    year: StudentYear = None
    parent_email: Optional[EmailStr] = None
    hostel_details: Optional[HostelDetails] = None
    enrollment_status: Optional[str] = None
    role: Optional[str] = None
    department: Optional[str] = None
    password: Optional[str] = Field(default=None, min_length=8, max_length=128)
    photo: Optional[str] = Field(default=None, max_length=7_000_000)
    # A student may be re-enrolled from the account edit form. The route
    # validates the target role and encrypts the PID data before persistence.
    fingerprint_enrollment: Optional[FingerprintEnrollment] = None

    @field_validator("photo")
    @classmethod
    def validate_photo_data(cls, value: Optional[str]) -> Optional[str]:
        return validate_photo(value)

    @field_validator("department")
    @classmethod
    def validate_department(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        department = value.strip()
        if not department:
            return None
        if department not in DEPARTMENTS:
            raise ValueError(f"Department must be one of: {', '.join(DEPARTMENTS)}")
        return department

class UserInDB(UserBase):
    id: PyObjectId = Field(default=None, alias="_id")
    password_hash: str

    model_config = ConfigDict(populate_by_name=True, json_encoders={ObjectId: str})

class UserResponse(UserBase):
    id: PyObjectId = Field(default=None, validation_alias=AliasChoices("_id", "id"), serialization_alias="id")
    live_status: Optional[str] = None
    active_outpass_status: Optional[str] = None
    fingerprint_enrolled: bool = False

    model_config = ConfigDict(populate_by_name=True, json_encoders={ObjectId: str})
