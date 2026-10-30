"""A manual entry the bank sync thinks it has seen, without enough proof to say so.

When a provider delivers a charge, the sync looks for a manual entry the
user already typed in. A single clear match is merged on the spot. Anything
less (a looser description, an amount a few cents off, two entries that
fit equally well) used to either merge silently or land a duplicate.
Neither is acceptable for money, so the bank row is stored as usual and
this row records the *doubt*: "this synced transaction may be that manual
one". The user settles it from the review queue.

`declined` is stored on purpose. Without it the same question would come
back after every sync. An accepted suggestion leaves no row: merging
deletes the bank row it pointed at.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Float, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.transaction import Transaction

STATUS_PENDING = "pending"
STATUS_DECLINED = "declined"


class SyncMatchSuggestion(Base):
    __tablename__ = "sync_match_suggestions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    # The entry the user typed, which survives a merge.
    manual_transaction_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("transactions.id", ondelete="CASCADE"), index=True
    )
    # The row the bank created, which a merge folds into the manual one.
    synced_transaction_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("transactions.id", ondelete="CASCADE"), index=True
    )
    score: Mapped[float] = mapped_column(Float, nullable=False)
    # Why the sync was unsure, as a stable key the UI translates:
    # "description" (amount and date fit, wording differs),
    # "amount" (wording fits, amount is close but not equal),
    # "ambiguous" (several manual entries fit equally well).
    reason: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default=STATUS_PENDING, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    manual_transaction: Mapped[Transaction] = relationship(
        foreign_keys=[manual_transaction_id], lazy="selectin"
    )
    synced_transaction: Mapped[Transaction] = relationship(
        foreign_keys=[synced_transaction_id], lazy="selectin"
    )

    __table_args__ = (
        UniqueConstraint(
            "manual_transaction_id", "synced_transaction_id", name="uq_sync_match_pair"
        ),
    )
