"""Doubtful manual-to-bank matches go to a review queue instead of merging
or duplicating silently."""
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_connection import BankConnection
from app.models.category import Category
from app.models.sync_match_suggestion import STATUS_DECLINED, SyncMatchSuggestion
from app.models.transaction import Transaction
from app.providers.base import AccountData, TransactionData
from app.services import sync_match_service
from app.services.connection_service import sync_connection

DAY = date(2026, 4, 10)


def _incoming(description="SUPERMERCADO ABC", amount="25.00", day=DAY, payee=None):
    return SimpleNamespace(
        description=description,
        amount=Decimal(amount),
        date=day,
        type="debit",
        payee=payee,
        external_id="bank-1",
    )


async def _account(session, user, *, connection_id=None, external_id=None) -> Account:
    account = Account(
        id=uuid.uuid4(), user_id=user.id, connection_id=connection_id,
        external_id=external_id, name="Card", type="credit_card",
        balance=Decimal("0"), currency="BRL",
    )
    session.add(account)
    await session.flush()
    return account


async def _manual(session, user, account, description, amount="25.00", day=DAY, **extra):
    tx = Transaction(
        id=uuid.uuid4(), user_id=user.id, account_id=account.id,
        description=description, amount=Decimal(amount), date=day,
        type="debit", source="manual", external_id=None,
        created_at=datetime.now(timezone.utc), **extra,
    )
    session.add(tx)
    await session.flush()
    return tx


# ---------------------------------------------------------------------------
# find_manual_match
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_single_clear_match_is_settled_alone(session: AsyncSession, test_user, test_workspace):
    account = await _account(session, test_user)
    manual = await _manual(session, test_user, account, "SUPERMERCADO ABC")

    match = await sync_match_service.find_manual_match(session, account.id, _incoming())

    assert match.strong is not None and match.strong.id == manual.id
    assert match.doubtful == []


@pytest.mark.asyncio
async def test_short_typed_name_is_doubtful_not_duplicated(
    session: AsyncSession, test_user, test_workspace
):
    """"Mercado" versus "SUPERMERCADO ABC" shares no word. Before, that
    inserted a twin; now it asks."""
    account = await _account(session, test_user)
    manual = await _manual(session, test_user, account, "Mercado")

    match = await sync_match_service.find_manual_match(session, account.id, _incoming())

    assert match.strong is None
    assert [c.transaction.id for c in match.doubtful] == [manual.id]
    assert match.doubtful[0].reason == sync_match_service.REASON_DESCRIPTION


@pytest.mark.asyncio
async def test_close_amount_with_same_wording_is_doubtful(
    session: AsyncSession, test_user, test_workspace
):
    account = await _account(session, test_user)
    manual = await _manual(session, test_user, account, "SUPERMERCADO ABC", amount="24.50")

    match = await sync_match_service.find_manual_match(session, account.id, _incoming())

    assert match.strong is None
    assert [c.transaction.id for c in match.doubtful] == [manual.id]
    assert match.doubtful[0].reason == sync_match_service.REASON_AMOUNT


@pytest.mark.asyncio
async def test_equally_good_candidates_are_ambiguous(
    session: AsyncSession, test_user, test_workspace
):
    account = await _account(session, test_user)
    first = await _manual(session, test_user, account, "SUPERMERCADO ABC")
    second = await _manual(session, test_user, account, "SUPERMERCADO ABC")

    match = await sync_match_service.find_manual_match(session, account.id, _incoming())

    assert match.strong is None
    assert {c.transaction.id for c in match.doubtful} == {first.id, second.id}
    assert {c.reason for c in match.doubtful} == {sync_match_service.REASON_AMBIGUOUS}


@pytest.mark.asyncio
async def test_better_candidate_wins_over_a_worse_one(
    session: AsyncSession, test_user, test_workspace
):
    account = await _account(session, test_user)
    good = await _manual(session, test_user, account, "SUPERMERCADO ABC")
    await _manual(session, test_user, account, "SUPERMERCADO ABC", day=date(2026, 4, 12))

    match = await sync_match_service.find_manual_match(session, account.id, _incoming())

    assert match.strong is not None and match.strong.id == good.id


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "amount, day",
    [
        ("60.00", DAY),  # amount too far
        ("25.00", date(2026, 4, 20)),  # outside the date window
    ],
)
async def test_far_candidates_are_ignored(
    session: AsyncSession, test_user, test_workspace, amount, day
):
    account = await _account(session, test_user)
    await _manual(session, test_user, account, "SUPERMERCADO ABC", amount=amount, day=day)

    match = await sync_match_service.find_manual_match(session, account.id, _incoming())

    assert match.strong is None and match.doubtful == []


@pytest.mark.asyncio
async def test_bank_rows_and_ignored_entries_are_never_candidates(
    session: AsyncSession, test_user, test_workspace
):
    account = await _account(session, test_user)
    await _manual(session, test_user, account, "SUPERMERCADO ABC", is_ignored=True)
    claimed = await _manual(session, test_user, account, "SUPERMERCADO ABC")
    claimed.external_id = "already-bank"
    await session.flush()

    match = await sync_match_service.find_manual_match(session, account.id, _incoming())

    assert match.strong is None and match.doubtful == []


def test_affinity_counts_a_word_inside_another():
    assert sync_match_service.description_affinity("Mercado", "SUPERMERCADO ABC") == 0.5
    assert sync_match_service.description_affinity("Pix", "Pixel Store") == 0.0
    assert sync_match_service.description_affinity("UBER TRIP", "uber trip") == 1.0


# ---------------------------------------------------------------------------
# the sync queues a doubt instead of merging or duplicating
# ---------------------------------------------------------------------------


async def _sync_once(session, user, workspace, conn, bank_description="SUPERMERCADO ABC"):
    provider = AsyncMock()
    provider.refresh_credentials = AsyncMock(return_value={"token": "t"})
    provider.get_accounts = AsyncMock(return_value=[
        AccountData(external_id="card-1", name="Card", type="credit_card",
                    balance=Decimal("0"), currency="BRL"),
    ])
    provider.get_transactions = AsyncMock(return_value=[
        TransactionData(
            external_id="bank-1", description=bank_description,
            amount=Decimal("25.00"), date=DAY, type="debit", currency="BRL",
        ),
    ])
    provider.get_bills = AsyncMock(return_value=[])
    with patch("app.services.connection_service.get_provider", return_value=provider), \
         patch("app.services.connection_service.detect_transfer_pairs", new_callable=AsyncMock), \
         patch("app.services.connection_service.stamp_primary_amount", new_callable=AsyncMock), \
         patch("app.services.connection_service.apply_rules_to_transaction", new_callable=AsyncMock):
        return await sync_connection(session, conn.id, workspace.id, user.id)


async def _connected_card(session, user):
    conn = BankConnection(
        id=uuid.uuid4(), user_id=user.id, provider="test",
        external_id=f"ext-{uuid.uuid4().hex[:8]}", institution_name="Bank",
        credentials={"token": "fake"}, status="active",
        last_sync_at=datetime.now(timezone.utc), created_at=datetime.now(timezone.utc),
    )
    session.add(conn)
    await session.flush()
    account = await _account(session, user, connection_id=conn.id, external_id="card-1")
    return conn, account


@pytest.mark.asyncio
async def test_sync_queues_a_doubtful_match(session: AsyncSession, test_user, test_workspace):
    conn, account = await _connected_card(session, test_user)
    manual = await _manual(session, test_user, account, "Mercado")
    manual_id, account_id = manual.id, account.id
    await session.commit()

    await _sync_once(session, test_user, test_workspace, conn)

    rows = (await session.execute(
        select(Transaction).where(Transaction.account_id == account_id)
    )).scalars().all()
    bank = next(t for t in rows if t.external_id == "bank-1")
    untouched = next(t for t in rows if t.id == manual_id)
    assert bank.id != manual_id and untouched.external_id is None
    suggestions = (await session.execute(select(SyncMatchSuggestion))).scalars().all()
    assert [(s.manual_transaction_id, s.synced_transaction_id) for s in suggestions] == [
        (manual_id, bank.id)
    ]

    # A second sync finds the bank row by its id and asks nothing again.
    await _sync_once(session, test_user, test_workspace, conn)
    assert len((await session.execute(select(SyncMatchSuggestion))).scalars().all()) == 1


@pytest.mark.asyncio
async def test_sync_without_a_doubt_queues_nothing(session: AsyncSession, test_user, test_workspace):
    conn, account = await _connected_card(session, test_user)
    await session.commit()

    await _sync_once(session, test_user, test_workspace, conn)

    assert (await session.execute(select(SyncMatchSuggestion))).scalars().all() == []


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


async def _queued_pair(session, user, workspace):
    conn, account = await _connected_card(session, user)
    category = Category(id=uuid.uuid4(), user_id=user.id, name="Groceries", icon="x", color="#000000")
    session.add(category)
    await session.flush()
    manual = await _manual(
        session, user, account, "Mercado", amount="24.50", category_id=category.id,
        notes="weekly shop",
    )
    bank = Transaction(
        id=uuid.uuid4(), user_id=user.id, account_id=account.id,
        description="SUPERMERCADO ABC", amount=Decimal("25.00"), date=DAY,
        type="debit", source="sync", external_id="bank-1", status="posted",
        raw_data={"bank": True}, created_at=datetime.now(timezone.utc),
    )
    session.add(bank)
    await session.flush()
    suggestion = SyncMatchSuggestion(
        workspace_id=workspace.id, account_id=account.id,
        manual_transaction_id=manual.id, synced_transaction_id=bank.id,
        score=0.5, reason="amount",
    )
    session.add(suggestion)
    await session.commit()
    return manual, bank, suggestion


@pytest.mark.asyncio
async def test_list_and_count(
    client: AsyncClient, auth_headers, session: AsyncSession, test_user, test_workspace
):
    manual, bank, suggestion = await _queued_pair(session, test_user, test_workspace)

    listed = await client.get("/api/sync-match-suggestions", headers=auth_headers)
    count = await client.get("/api/sync-match-suggestions/count", headers=auth_headers)

    assert listed.status_code == 200
    [row] = listed.json()
    assert row["id"] == str(suggestion.id)
    assert row["manual"]["description"] == "Mercado"
    assert row["synced"]["description"] == "SUPERMERCADO ABC"
    assert count.json() == {"pending": 1}


@pytest.mark.asyncio
async def test_merge_keeps_the_manual_entry_and_takes_the_bank_facts(
    client: AsyncClient, auth_headers, session: AsyncSession, test_user, test_workspace
):
    manual, bank, suggestion = await _queued_pair(session, test_user, test_workspace)
    category_id = manual.category_id
    bank_id = bank.id
    manual_id = manual.id

    response = await client.post(
        f"/api/sync-match-suggestions/{suggestion.id}/merge", headers=auth_headers
    )

    assert response.status_code == 204
    session.expire_all()
    merged = await session.get(Transaction, manual_id)
    assert merged.external_id == "bank-1"
    assert merged.source == "sync"
    assert merged.amount == Decimal("25.00")
    assert merged.raw_data == {"bank": True}
    assert merged.category_id == category_id
    assert merged.notes == "weekly shop"
    assert await session.get(Transaction, bank_id) is None
    assert (await session.execute(select(SyncMatchSuggestion))).scalars().all() == []
    assert (await client.get("/api/sync-match-suggestions/count", headers=auth_headers)).json() == {
        "pending": 0
    }


@pytest.mark.asyncio
async def test_decline_keeps_both_rows_and_remembers(
    client: AsyncClient, auth_headers, session: AsyncSession, test_user, test_workspace
):
    manual, bank, suggestion = await _queued_pair(session, test_user, test_workspace)
    manual_id, bank_id, suggestion_id = manual.id, bank.id, suggestion.id

    response = await client.post(
        f"/api/sync-match-suggestions/{suggestion_id}/decline", headers=auth_headers
    )

    assert response.status_code == 204
    session.expire_all()
    assert await session.get(Transaction, manual_id) is not None
    assert await session.get(Transaction, bank_id) is not None
    stored = await session.get(SyncMatchSuggestion, suggestion_id)
    assert stored.status == STATUS_DECLINED
    assert (await client.get("/api/sync-match-suggestions", headers=auth_headers)).json() == []
    # A resolved suggestion cannot be acted on again.
    again = await client.post(
        f"/api/sync-match-suggestions/{suggestion_id}/merge", headers=auth_headers
    )
    assert again.status_code == 404


@pytest.mark.asyncio
async def test_merge_is_refused_when_the_bank_row_is_tied_to_something(
    client: AsyncClient, auth_headers, session: AsyncSession, test_user, test_workspace
):
    manual, bank, suggestion = await _queued_pair(session, test_user, test_workspace)
    bank_id, suggestion_id = bank.id, suggestion.id

    with patch.object(sync_match_service, "_is_tied_down", AsyncMock(return_value=True)):
        response = await client.post(
            f"/api/sync-match-suggestions/{suggestion_id}/merge", headers=auth_headers
        )

    assert response.status_code == 409
    session.expire_all()
    assert await session.get(Transaction, bank_id) is not None
