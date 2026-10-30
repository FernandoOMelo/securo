"""The available-balance card: where the month started and where it should end."""
import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.core.app_clock import app_today
from app.models.account import Account
from app.models.transaction import Transaction


@pytest_asyncio.fixture
async def money(session, test_user):
    today = app_today()
    month_start = today.replace(day=1)
    last_month = month_start - timedelta(days=5)
    future = today + timedelta(days=1)

    def account(name, kind):
        acc = Account(
            id=uuid.uuid4(), user_id=test_user.id, name=name, type=kind,
            balance=Decimal("0"), currency="BRL",
        )
        session.add(acc)
        return acc

    checking = account("Conta", "checking")
    card = account("Cartão", "credit_card")
    await session.flush()

    def tx(acc, kind, amount, day, status="posted"):
        session.add(Transaction(
            id=uuid.uuid4(), user_id=test_user.id, account_id=acc.id, description="x",
            amount=Decimal(amount), currency="BRL", date=day, type=kind, source="manual",
            status=status,
        ))

    tx(checking, "credit", "1000", last_month)       # before the month: the opening
    tx(checking, "debit", "300", month_start)         # spent this month
    tx(checking, "debit", "50", future, "pending")    # still to leave
    tx(card, "debit", "999", month_start)             # a card never counts
    await session.commit()


@pytest.mark.asyncio
async def test_available_opening_and_projected_cover_checking_and_savings_only(
    client: AsyncClient, auth_headers, money
):
    resp = await client.get("/api/dashboard/summary", headers=auth_headers)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["available_opening_primary"] == 1000.0
    # 1000 - 300 now, minus the 50 still pending (a card charge never enters).
    assert body["available_projected_primary"] == 650.0
