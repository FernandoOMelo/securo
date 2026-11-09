import uuid
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Numeric
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.category import Category
    from app.models.transaction import Transaction


class TransactionCategorySplit(Base):
    """One category's share of a transaction's amount.

    A transaction with parts keeps `category_id` as its main category (the
    largest part) so every place that reads a single category keeps working;
    the parts are what budgets and reports aggregate when they exist.
    """

    __tablename__ = "transaction_category_splits"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    transaction_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("transactions.id", ondelete="CASCADE"), index=True
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="CASCADE"), index=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(precision=15, scale=2))

    transaction: Mapped["Transaction"] = relationship(back_populates="category_splits")
    category: Mapped["Category"] = relationship(lazy="selectin")
