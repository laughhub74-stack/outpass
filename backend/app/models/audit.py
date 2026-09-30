from datetime import datetime
from typing import Dict, Any, List
from bson import ObjectId
from pydantic import BaseModel, Field, AliasChoices, ConfigDict
from app.models.user import PyObjectId

class AuditLogBase(BaseModel):
    action: str = Field(..., json_schema_extra={"example": "UPDATE_USER"})
    affected_model: str = Field(..., json_schema_extra={"example": "User"})
    affected_id: PyObjectId
    changes: Dict[str, List[Any]] = Field(..., json_schema_extra={"example": {"email": ["old@mail.com", "new@mail.com"]}})

class AuditLogCreate(AuditLogBase):
    actor_id: PyObjectId
    actor_name: str

class AuditLogResponse(AuditLogBase):
    id: PyObjectId = Field(default=None, validation_alias=AliasChoices("_id", "id"), serialization_alias="id")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    actor_id: PyObjectId
    actor_name: str
    immutable: bool = True

    model_config = ConfigDict(populate_by_name=True, json_encoders={ObjectId: str})
