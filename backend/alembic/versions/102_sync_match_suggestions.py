"""review queue for doubtful manual-to-bank transaction matches

Revision ID: 102
Revises: 101
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "102"
down_revision = "101"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "sync_match_suggestions" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "sync_match_suggestions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "workspace_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "account_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "manual_transaction_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("transactions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "synced_transaction_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("transactions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("reason", sa.String(20), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "manual_transaction_id", "synced_transaction_id", name="uq_sync_match_pair"
        ),
    )
    for column in (
        "workspace_id",
        "account_id",
        "manual_transaction_id",
        "synced_transaction_id",
        "status",
    ):
        op.create_index(f"ix_sync_match_suggestions_{column}", "sync_match_suggestions", [column])


def downgrade() -> None:
    op.drop_table("sync_match_suggestions")
