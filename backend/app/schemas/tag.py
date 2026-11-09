import uuid
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class TagUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    color: Optional[str] = Field(default=None, max_length=9)


class TagSummary(BaseModel):
    id: uuid.UUID
    name: str
    color: Optional[str] = None
    transaction_count: int = 0

    model_config = ConfigDict(from_attributes=True)
