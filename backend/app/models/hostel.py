from typing import Optional, List
from bson import ObjectId
from pydantic import BaseModel, Field, ConfigDict, field_validator

# Reuse the PyObjectId helper from user model
from .user import PyObjectId

class HostelBase(BaseModel):
    name: str = Field(..., json_schema_extra={"example": "A-Block"})
    warden_id: Optional[PyObjectId] = Field(None, description="Reference to a User with role 'warden'")
    capacity: Optional[int] = Field(None, ge=0, description='Maximum number of students')
    address: Optional[str] = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("hostel name must not be empty")
        return normalized

class HostelCreate(HostelBase):
    pass

class HostelUpdate(BaseModel):
    name: Optional[str] = None
    warden_id: Optional[PyObjectId] = None
    capacity: Optional[int] = None
    address: Optional[str] = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("hostel name must not be empty")
        return normalized

class HostelInDB(HostelBase):
    id: PyObjectId = Field(alias='_id')
    model_config = ConfigDict(populate_by_name=True, json_encoders={ObjectId: str})
