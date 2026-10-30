"""margin (in %) a recurring bill's real charge may differ from its amount

Revision ID: 103
Revises: 102
"""

import sqlalchemy as sa

from alembic import op

revision = "103"
down_revision = "102"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("recurring_transactions")}
    if "amount_tolerance_percent" in columns:
        return
    op.add_column(
        "recurring_transactions",
        sa.Column(
            "amount_tolerance_percent",
            sa.Numeric(5, 2),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("recurring_transactions", "amount_tolerance_percent")
