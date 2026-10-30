"""Settling and ignoring many transactions at once.

The bulk versions of "post today" and "ignore": same rules as the single actions,
applied to a selection, skipping what does not apply instead of failing the batch.
"""
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

from httpx import AsyncClient

from app.core.app_clock import app_today
from app.models.account import Account
from app.models.transaction import Transaction
from app.models.user import User
from app.services.workspace_service import create_personal_workspace_for_user


async def _tx(session, user, account, *, status="pending", days_ago=3, description="x", **extra):
    tx = Transaction(
        id=uuid4(), user_id=user.id, account_id=account.id, description=description,
        amount=Decimal("10.00"), date=app_today() - timedelta(days=days_ago), type="debit",
        source="manual", status=status, **extra,
    )
    session.add(tx)
    await session.flush()
    return tx


async def test_bulk_post_settles_pending_rows_and_dates_them_today(
    client: AsyncClient, auth_headers, session, test_user, test_account
):
    first = await _tx(session, test_user, test_account)
    second = await _tx(session, test_user, test_account, days_ago=10)
    ids = [str(first.id), str(second.id)]
    await session.commit()

    resp = await client.post(
        "/api/transactions/bulk-post", json={"transaction_ids": ids}, headers=auth_headers
    )

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"updated": 2, "skipped": 0}
    await session.refresh(first)
    await session.refresh(second)
    assert (first.status, first.date) == ("posted", app_today())
    assert (second.status, second.date) == ("posted", app_today())


async def test_bulk_post_can_keep_each_date(
    client: AsyncClient, auth_headers, session, test_user, test_account
):
    tx = await _tx(session, test_user, test_account, days_ago=5)
    original = tx.date
    tx_id = str(tx.id)
    await session.commit()

    resp = await client.post(
        "/api/transactions/bulk-post",
        json={"transaction_ids": [tx_id], "keep_date": True},
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    await session.refresh(tx)
    assert tx.status == "posted" and tx.date == original


async def test_bulk_post_skips_what_is_already_posted_and_unknown_ids(
    client: AsyncClient, auth_headers, session, test_user, test_account
):
    pending = await _tx(session, test_user, test_account)
    settled = await _tx(session, test_user, test_account, status="posted", days_ago=7)
    settled_date = settled.date
    ids = [str(pending.id), str(settled.id), str(uuid4())]
    await session.commit()

    resp = await client.post(
        "/api/transactions/bulk-post", json={"transaction_ids": ids}, headers=auth_headers
    )

    assert resp.json() == {"updated": 1, "skipped": 2}
    await session.refresh(settled)
    assert settled.date == settled_date, "a settled row must not be re-dated"


async def test_bulk_post_carries_the_change_to_a_transfer_partner_once(
    client: AsyncClient, auth_headers, session, test_user, test_account
):
    other = Account(
        id=uuid4(), user_id=test_user.id, name="Savings", type="savings",
        balance=Decimal("0"), currency="USD",
    )
    session.add(other)
    await session.flush()
    pair = uuid4()
    out = await _tx(session, test_user, test_account, transfer_pair_id=pair)
    into = await _tx(session, test_user, other, transfer_pair_id=pair)
    into.type = "credit"
    ids = [str(out.id), str(into.id)]  # both legs selected
    await session.commit()

    resp = await client.post(
        "/api/transactions/bulk-post", json={"transaction_ids": ids}, headers=auth_headers
    )

    assert resp.json() == {"updated": 2, "skipped": 0}
    await session.refresh(out)
    await session.refresh(into)
    assert out.status == into.status == "posted"
    assert out.date == into.date == app_today()


async def test_bulk_post_ignores_other_workspaces(
    client: AsyncClient, auth_headers, session, test_user, test_account
):
    stranger = User(
        id=uuid4(), email=f"{uuid4().hex}@example.com", hashed_password="x",
        is_active=True, is_verified=True, preferences={},
    )
    session.add(stranger)
    await session.flush()
    await create_personal_workspace_for_user(session, stranger)
    foreign_account = Account(
        id=uuid4(), user_id=stranger.id, name="Theirs", type="checking",
        balance=Decimal("0"), currency="USD",
    )
    session.add(foreign_account)
    await session.flush()
    foreign = await _tx(session, stranger, foreign_account)
    foreign_id = str(foreign.id)
    await session.commit()

    resp = await client.post(
        "/api/transactions/bulk-post", json={"transaction_ids": [foreign_id]}, headers=auth_headers
    )

    assert resp.json() == {"updated": 0, "skipped": 1}
    await session.refresh(foreign)
    assert foreign.status == "pending"


async def test_bulk_post_needs_at_least_one_id(client: AsyncClient, auth_headers):
    resp = await client.post(
        "/api/transactions/bulk-post", json={"transaction_ids": []}, headers=auth_headers
    )

    assert resp.status_code == 422


async def test_a_viewer_cannot_bulk_post_or_ignore(
    client: AsyncClient, viewer_auth_headers, session, test_user, test_account
):
    tx = await _tx(session, test_user, test_account)
    ids = [str(tx.id)]
    await session.commit()

    post = await client.post(
        "/api/transactions/bulk-post", json={"transaction_ids": ids}, headers=viewer_auth_headers
    )
    ignore = await client.post(
        "/api/transactions/bulk-ignore", json={"transaction_ids": ids}, headers=viewer_auth_headers
    )

    assert post.status_code == 403 and ignore.status_code == 403


async def test_bulk_ignore_and_restore(
    client: AsyncClient, auth_headers, session, test_user, test_account
):
    first = await _tx(session, test_user, test_account)
    second = await _tx(session, test_user, test_account, is_ignored=True)
    ids = [str(first.id), str(second.id)]
    await session.commit()

    ignored = await client.post(
        "/api/transactions/bulk-ignore", json={"transaction_ids": ids}, headers=auth_headers
    )
    # `second` was already ignored, so only `first` changes.
    assert ignored.json() == {"updated": 1, "skipped": 1}
    await session.refresh(first)
    await session.refresh(second)
    assert first.is_ignored and second.is_ignored

    restored = await client.post(
        "/api/transactions/bulk-ignore",
        json={"transaction_ids": ids, "ignored": False},
        headers=auth_headers,
    )
    assert restored.json() == {"updated": 2, "skipped": 0}
    await session.refresh(first)
    await session.refresh(second)
    assert not first.is_ignored and not second.is_ignored
