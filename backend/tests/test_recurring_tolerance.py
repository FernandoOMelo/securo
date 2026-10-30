"""A recurring bill with a margin: the real charge never lands on the same cent."""
import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.reconciliation import ReconciliationSuggestion
from app.models.transaction import Transaction
from app.schemas.recurring_transaction import RecurringTransactionCreate
from app.services import reconciliation_service, recurring_match_service as rms
from app.services.recurring_transaction_service import create_recurring_transaction


@pytest_asyncio.fixture
async def account(session: AsyncSession, test_user, test_workspace) -> Account:
    acc = Account(
        id=uuid.uuid4(), user_id=test_user.id, workspace_id=test_workspace.id,
        name="Conta", type="checking", balance=Decimal("10000"), currency="BRL",
    )
    session.add(acc)
    await session.commit()
    await session.refresh(acc)
    return acc


async def _bill(session, workspace, user, account, tolerance, auto_generate=False):
    return await create_recurring_transaction(
        session, workspace.id, user.id,
        RecurringTransactionCreate(
            description="Conta de luz", amount=Decimal("200.00"), currency="BRL",
            type="debit", frequency="monthly", start_date=date(2025, 3, 10),
            account_id=account.id, auto_generate=auto_generate,
            amount_tolerance_percent=Decimal(tolerance),
        ),
    )


async def _charge(session, user, workspace, account, amount, external_id="ext-1"):
    tx = Transaction(
        user_id=user.id, workspace_id=workspace.id, account_id=account.id,
        description="CONTA DE LUZ", amount=Decimal(amount), currency="BRL",
        date=date(2025, 3, 11), type="debit", source="sync", status="posted",
        external_id=external_id,
    )
    session.add(tx)
    await session.commit()
    await session.refresh(tx)
    return tx


@pytest.mark.asyncio
async def test_charge_within_margin_is_taken_for_the_bill(
    session, test_user, test_workspace, account
):
    await _bill(session, test_workspace, test_user, account, "10")

    found = await rms.find_bill_for_incoming(
        session, test_user.id, account.id, Decimal("207.35"), "BRL", "debit",
        date(2025, 3, 11), "CONTA DE LUZ",
    )

    assert found is not None


@pytest.mark.asyncio
async def test_without_a_margin_the_amount_stays_exact(
    session, test_user, test_workspace, account
):
    await _bill(session, test_workspace, test_user, account, "0")

    found = await rms.find_bill_for_incoming(
        session, test_user.id, account.id, Decimal("200.01"), "BRL", "debit",
        date(2025, 3, 11), "CONTA DE LUZ",
    )

    assert found is None


@pytest.mark.asyncio
async def test_charge_past_the_margin_is_not_linked(
    session, test_user, test_workspace, account
):
    await _bill(session, test_workspace, test_user, account, "5")

    found = await rms.find_bill_for_incoming(
        session, test_user.id, account.id, Decimal("230.00"), "BRL", "debit",
        date(2025, 3, 11), "CONTA DE LUZ",
    )

    assert found is None


@pytest.mark.asyncio
async def test_generated_placeholder_takes_the_real_amount(
    session, test_user, test_workspace, account
):
    bill = await _bill(session, test_workspace, test_user, account, "10", auto_generate=True)
    placeholder = Transaction(
        user_id=test_user.id, workspace_id=test_workspace.id, account_id=account.id,
        description="Conta de luz", amount=Decimal("200.00"), currency="BRL",
        date=date(2025, 3, 10), type="debit", source="recurring", status="pending",
        recurring_transaction_id=bill.id,
    )
    session.add(placeholder)
    await session.commit()

    found = await rms.find_placeholder_for_incoming(
        session, account.id, Decimal("207.35"), "BRL", "debit",
        date(2025, 3, 11), "CONTA DE LUZ",
    )

    assert found is not None and found.id == placeholder.id


@pytest.mark.asyncio
async def test_charge_just_past_the_margin_goes_to_the_review_queue(
    session, test_user, test_workspace, account
):
    bill = await _bill(session, test_workspace, test_user, account, "5")
    tx = await _charge(session, test_user, test_workspace, account, "225.00")

    await reconciliation_service._suggest_recurring(
        session, test_workspace.id, [tx]
    )
    await session.commit()

    rows = (await session.execute(select(ReconciliationSuggestion))).scalars().all()
    assert [(r.expectation_id, r.transaction_id) for r in rows] == [(bill.id, tx.id)]


@pytest.mark.asyncio
async def test_charge_far_past_the_margin_is_not_even_offered(
    session, test_user, test_workspace, account
):
    await _bill(session, test_workspace, test_user, account, "5")
    tx = await _charge(session, test_user, test_workspace, account, "400.00")

    await reconciliation_service._suggest_recurring(
        session, test_workspace.id, [tx]
    )

    rows = (await session.execute(select(ReconciliationSuggestion))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_accepting_replaces_the_bills_own_placeholder(
    client, auth_headers, session, test_user, test_workspace, account
):
    bill = await _bill(session, test_workspace, test_user, account, "5", auto_generate=True)
    placeholder = Transaction(
        user_id=test_user.id, workspace_id=test_workspace.id, account_id=account.id,
        description="Conta de luz", amount=Decimal("200.00"), currency="BRL",
        date=date(2025, 3, 10), type="debit", source="recurring", status="pending",
        recurring_transaction_id=bill.id,
    )
    session.add(placeholder)
    tx = await _charge(session, test_user, test_workspace, account, "225.00")
    placeholder_id, tx_id, bill_id = placeholder.id, tx.id, bill.id
    await reconciliation_service._suggest_recurring(session, test_workspace.id, [tx])
    await session.commit()
    suggestion = (await session.execute(select(ReconciliationSuggestion))).scalars().one()

    resp = await client.post(
        f"/api/reconciliation/suggestions/{suggestion.id}/accept", headers=auth_headers
    )

    assert resp.status_code == 200, resp.text
    session.expire_all()
    assert await session.get(Transaction, placeholder_id) is None
    assert (await session.get(Transaction, tx_id)).recurring_transaction_id == bill_id
