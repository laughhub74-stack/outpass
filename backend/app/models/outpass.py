from datetime import datetime, timedelta, timezone
from typing import Optional, List
from bson import ObjectId
from pydantic import BaseModel, Field, AliasChoices, ConfigDict, field_validator, model_validator
from app.models.user import PyObjectId

class HistoryItem(BaseModel):
    status: str
    updated_by: PyObjectId
    updated_by_name: str
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    comments: Optional[str] = None

class OutpassBase(BaseModel):
    destination: str = Field(..., min_length=3, max_length=100)
    reason: str = Field(..., min_length=5, max_length=500)
    out_date: datetime
    in_date: datetime

MAX_OUTPASS_DURATION = timedelta(days=30)
# Allow for clock skew between the student's device and the server.
OUT_DATE_PAST_TOLERANCE = timedelta(minutes=5)


def to_naive_utc(value: datetime) -> datetime:
    """MongoDB stores naive UTC datetimes; normalise aware inputs to match."""
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


class OutpassCreate(OutpassBase):
    @field_validator("out_date", "in_date")
    @classmethod
    def normalise_dates(cls, value: datetime) -> datetime:
        return to_naive_utc(value)

    @model_validator(mode="after")
    def validate_time_window(self):
        now = datetime.utcnow()
        if self.out_date < now - OUT_DATE_PAST_TOLERANCE:
            raise ValueError("out_date cannot be in the past")
        if self.in_date <= self.out_date:
            raise ValueError("in_date must be after out_date")
        if self.in_date - self.out_date > MAX_OUTPASS_DURATION:
            raise ValueError("Outpass duration cannot exceed 30 days")
        return self

class OutpassApprove(BaseModel):
    comments: Optional[str] = None

class OutpassReject(BaseModel):
    rejection_reason: str = Field(..., min_length=3, max_length=500)

class OutpassResponse(OutpassBase):
    id: PyObjectId = Field(default=None, validation_alias=AliasChoices("_id", "id"), serialization_alias="id")
    student_id: PyObjectId
    student_name: str
    roll_number: str
    department: Optional[str] = None
    room: Optional[str] = None
    hostel_name: Optional[str] = None
    status: str = "Pending"
    qr_token: Optional[str] = None
    rejection_reason: Optional[str] = None
    history: List[HistoryItem] = []
    exit_time: Optional[datetime] = None
    entry_time: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = ConfigDict(populate_by_name=True, json_encoders={ObjectId: str})
