"""transaction form fields: dates, auto-settle, charge/discount, ignore flags, tags, category splits

Revision ID: 104
Revises: 103
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision = "104"
down_revision = "103"
branch_labels = None
depends_on = None

_FALSE = sa.text("false")


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    existing = _columns("transactions")
    additions = [
        sa.Column("settled_date", sa.Date(), nullable=True),
        sa.Column("launch_date", sa.Date(), nullable=True),
        sa.Column("auto_settle", sa.Boolean(), nullable=False, server_default=_FALSE),
        sa.Column("adjustment_type", sa.String(10), nullable=True),
        sa.Column("adjustment_amount", sa.Numeric(15, 2), nullable=True),
        sa.Column("original_amount", sa.Numeric(15, 2), nullable=True),
        sa.Column("ignore_in_stats", sa.Boolean(), nullable=False, server_default=_FALSE),
        sa.Column("ignore_in_budgets", sa.Boolean(), nullable=False, server_default=_FALSE),
        sa.Column("ignore_in_savings", sa.Boolean(), nullable=False, server_default=_FALSE),
        sa.Column("ignore_in_card_limit", sa.Boolean(), nullable=False, server_default=_FALSE),
    ]
    for column in additions:
        if column.name not in existing:
            op.add_column("transactions", column)

    # Rows already settled keep their own date as the settlement date.
    op.execute(
        "UPDATE transactions SET settled_date = date "
        "WHERE settled_date IS NULL AND status = 'posted'"
    )
    op.execute(
        "UPDATE transactions SET launch_date = CAST(created_at AS date) "
        "WHERE launch_date IS NULL"
    )

    tables = _tables()
    if "tags" not in tables:
        op.create_table(
            "tags",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "workspace_id",
                UUID(as_uuid=True),
                sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column("name", sa.String(60), nullable=False),
            sa.Column("color", sa.String(9), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("workspace_id", "name", name="uq_tags_workspace_name"),
        )
    if "transaction_tags" not in tables:
        op.create_table(
            "transaction_tags",
            sa.Column(
                "transaction_id",
                UUID(as_uuid=True),
                sa.ForeignKey("transactions.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column(
                "tag_id",
                UUID(as_uuid=True),
                sa.ForeignKey("tags.id", ondelete="CASCADE"),
                primary_key=True,
                index=True,
            ),
        )
    if "transaction_category_splits" not in tables:
        op.create_table(
            "transaction_category_splits",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "transaction_id",
                UUID(as_uuid=True),
                sa.ForeignKey("transactions.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column(
                "category_id",
                UUID(as_uuid=True),
                sa.ForeignKey("categories.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        )


def downgrade() -> None:
    op.drop_table("transaction_category_splits")
    op.drop_table("transaction_tags")
    op.drop_table("tags")
    for name in (
        "ignore_in_card_limit",
        "ignore_in_savings",
        "ignore_in_budgets",
        "ignore_in_stats",
        "original_amount",
        "adjustment_amount",
        "adjustment_type",
        "auto_settle",
        "launch_date",
        "settled_date",
    ):
        op.drop_column("transactions", name)
