import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Column, DateTime, ForeignKey, String, Table, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

transaction_tags = Table(
    "transaction_tags",
    Base.metadata,
    Column(
        "transaction_id",
        UUID(as_uuid=True),
        ForeignKey("transactions.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "tag_id",
        UUID(as_uuid=True),
        ForeignKey("tags.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    ),
)


class Tag(Base):
    __tablename__ = "tags"
    __table_args__ = (UniqueConstraint("workspace_id", "name", name="uq_tags_workspace_name"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(60))
    color: Mapped[Optional[str]] = mapped_column(String(9), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
