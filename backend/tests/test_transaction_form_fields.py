"""Transaction form fields: settlement dates, charge/discount, ignore flags,
tags, category parts and the auto-settle job."""
import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.app_clock import app_today
from app.models.account import Account
from app.models.budget import Budget
from app.models.tag import Tag
from app.models.transaction import Transaction
from app.schemas.transaction import (
    CategorySplitInput,
    TransactionCreate,
    TransactionRead,
    TransactionUpdate,
)
from app.services import transaction_extras
from app.services.budget_service import get_budget_vs_actual
from app.services.transaction_service import create_transaction, update_transaction


@pytest_asyncio.fixture
async def account(session: AsyncSession, test_user) -> Account:
    acc = Account(
        id=uuid.uuid4(),
        user_id=test_user.id,
        name="FormAcc",
        type="checking",
        balance=Decimal("0"),
        currency="BRL",
    )
    session.add(acc)
    await session.commit()
    await session.refresh(acc)
    return acc


def _create(account, **overrides) -> TransactionCreate:
    base = dict(
        description="Conta",
        amount=Decimal("100.00"),
        date=date(2025, 3, 10),
        type="debit",
        account_id=account.id,
    )
    base.update(overrides)
    return TransactionCreate(**base)


# ---------------------------------------------------------------------------
# charge / discount
# ---------------------------------------------------------------------------


def test_resolve_adjustment_charge_and_discount():
    charge = transaction_extras.resolve_adjustment(Decimal("100"), "charge", Decimal("5"))
    assert charge["amount"] == Decimal("105")
    assert charge["original_amount"] == Decimal("100")

    discount = transaction_extras.resolve_adjustment(Decimal("100"), "discount", Decimal("10"))
    assert discount["amount"] == Decimal("90")

    none = transaction_extras.resolve_adjustment(Decimal("100"), None, None)
    assert none == {
        "amount": Decimal("100"),
        "original_amount": None,
        "adjustment_type": None,
        "adjustment_amount": None,
    }


def test_resolve_adjustment_rejects_discount_covering_amount():
    with pytest.raises(ValueError):
        transaction_extras.resolve_adjustment(Decimal("100"), "discount", Decimal("100"))


@pytest.mark.asyncio
async def test_create_with_discount_stores_final_amount(
    session, test_user, test_workspace, account
):
    tx = await create_transaction(
        session,
        test_workspace.id,
        test_user.id,
        _create(account, adjustment_type="discount", adjustment_amount=Decimal("15")),
    )
    assert tx.amount == Decimal("85.00")
    assert tx.original_amount == Decimal("100.00")
    assert tx.adjustment_type == "discount"


@pytest.mark.asyncio
async def test_update_adjustment_recomputes_from_original(
    session, test_user, test_workspace, account
):
    tx = await create_transaction(
        session,
        test_workspace.id,
        test_user.id,
        _create(account, adjustment_type="charge", adjustment_amount=Decimal("10")),
    )
    assert tx.amount == Decimal("110.00")

    updated = await update_transaction(
        session,
        tx.id,
        test_workspace.id,
        test_user.id,
        TransactionUpdate(adjustment_type="charge", adjustment_amount=Decimal("20")),
    )
    assert updated.amount == Decimal("120.00")
    assert updated.original_amount == Decimal("100.00")

    cleared = await update_transaction(
        session,
        tx.id,
        test_workspace.id,
        test_user.id,
        TransactionUpdate(adjustment_type=None, adjustment_amount=None),
    )
    assert cleared.amount == Decimal("100.00")
    assert cleared.adjustment_type is None
    assert cleared.original_amount is None


@pytest.mark.asyncio
async def test_plain_amount_edit_drops_adjustment(
    session, test_user, test_workspace, account
):
    tx = await create_transaction(
        session,
        test_workspace.id,
        test_user.id,
        _create(account, adjustment_type="charge", adjustment_amount=Decimal("10")),
    )
    updated = await update_transaction(
        session, tx.id, test_workspace.id, test_user.id,
        TransactionUpdate(amount=Decimal("50")),
    )
    assert updated.amount == Decimal("50")
    assert updated.adjustment_type is None
    assert updated.original_amount is None


# ---------------------------------------------------------------------------
# settlement dates
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_settled_date_follows_status(session, test_user, test_workspace, account):
    pending = await create_transaction(
        session, test_workspace.id, test_user.id,
        _create(account, status="pending", date=app_today() + timedelta(days=3)),
    )
    assert pending.settled_date is None
    assert pending.launch_date == app_today()

    settled = await update_transaction(
        session, pending.id, test_workspace.id, test_user.id,
        TransactionUpdate(status="posted", settled_date=app_today()),
    )
    assert settled.settled_date == app_today()

    back = await update_transaction(
        session, pending.id, test_workspace.id, test_user.id,
        TransactionUpdate(status="pending"),
    )
    assert back.settled_date is None


@pytest.mark.asyncio
async def test_posted_create_defaults_settled_date_to_due_date(
    session, test_user, test_workspace, account
):
    tx = await create_transaction(
        session, test_workspace.id, test_user.id, _create(account)
    )
    assert tx.settled_date == date(2025, 3, 10)


@pytest.mark.asyncio
async def test_auto_settle_posts_only_due_flagged_rows(
    session, test_user, test_workspace, account
):
    today = app_today()
    due = await create_transaction(
        session, test_workspace.id, test_user.id,
        _create(account, status="pending", date=today - timedelta(days=1), auto_settle=True),
    )
    future = await create_transaction(
        session, test_workspace.id, test_user.id,
        _create(account, status="pending", date=today + timedelta(days=5), auto_settle=True),
    )
    manual = await create_transaction(
        session, test_workspace.id, test_user.id,
        _create(account, status="pending", date=today - timedelta(days=1)),
    )

    assert await transaction_extras.settle_due_transactions(session) == 1

    for tx in (due, future, manual):
        await session.refresh(tx)
    assert due.status == "posted"
    assert due.settled_date == today - timedelta(days=1)
    assert future.status == "pending"
    assert manual.status == "pending"


# ---------------------------------------------------------------------------
# ignore flags
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_and_update_ignore_flags(session, test_user, test_workspace, account):
    tx = await create_transaction(
        session, test_workspace.id, test_user.id,
        _create(account, ignore_in_stats=True, ignore_in_card_limit=True, is_ignored=True),
    )
    assert tx.ignore_in_stats and tx.ignore_in_card_limit and tx.is_ignored
    assert not tx.ignore_in_budgets and not tx.ignore_in_savings

    updated = await update_transaction(
        session, tx.id, test_workspace.id, test_user.id,
        TransactionUpdate(ignore_in_budgets=True, ignore_in_stats=False),
    )
    assert updated.ignore_in_budgets
    assert not updated.ignore_in_stats

    read = TransactionRead.model_validate(updated)
    assert read.ignore_in_budgets is True


@pytest.mark.asyncio
async def test_ignore_in_budgets_leaves_row_out_of_budget_only(
    session, test_user, test_workspace, account, test_categories
):
    category = test_categories[0]
    today = app_today()
    month_start = today.replace(day=1)
    session.add(
        Budget(
            user_id=test_user.id,
            workspace_id=test_workspace.id,
            category_id=category.id,
            amount=Decimal("500"),
            month=month_start,
        )
    )
    await session.commit()

    counted = await create_transaction(
        session, test_workspace.id, test_user.id,
        _create(account, date=month_start, category_id=category.id, amount=Decimal("100")),
    )
    skipped = await create_transaction(
        session, test_workspace.id, test_user.id,
        _create(
            account, date=month_start, category_id=category.id,
            amount=Decimal("40"), ignore_in_budgets=True,
        ),
    )
    assert counted.id != skipped.id

    comparison = await get_budget_vs_actual(session, test_workspace.id, test_user.id, month_start)
    row = next(r for r in comparison if str(r.category_id) == str(category.id))
    assert Decimal(str(row.actual_amount)) == Decimal("100")


# ---------------------------------------------------------------------------
# tags
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tags_are_created_deduplicated_and_replaced(
    session, test_user, test_workspace, account
):
    tx = await create_transaction(
        session, test_workspace.id, test_user.id,
        _create(account, tags=["Viagem", "#viagem", " Férias "]),
    )
    assert sorted(t.name for t in tx.tags) == ["Férias", "Viagem"]

    other = await create_transaction(
        session, test_workspace.id, test_user.id,
        _create(account, tags=["viagem"]),
    )
    all_tags = (await session.execute(select(Tag))).scalars().all()
    assert len(all_tags) == 2  # "viagem" reused the existing tag
    assert [t.name for t in other.tags] == ["Viagem"]

    updated = await update_transaction(
        session, tx.id, test_workspace.id, test_user.id, TransactionUpdate(tags=[])
    )
    assert updated.tags == []


# ---------------------------------------------------------------------------
# category parts
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_category_parts_must_add_up(session, test_user, test_workspace, account, test_categories):
    a, b = test_categories[0], test_categories[1]
    with pytest.raises(ValueError):
        await create_transaction(
            session, test_workspace.id, test_user.id,
            _create(
                account,
                category_splits=[
                    CategorySplitInput(category_id=a.id, amount=Decimal("60")),
                    CategorySplitInput(category_id=b.id, amount=Decimal("30")),
                ],
            ),
        )


@pytest.mark.asyncio
async def test_category_parts_set_main_category_and_rescale(
    session, test_user, test_workspace, account, test_categories
):
    a, b = test_categories[0], test_categories[1]
    tx = await create_transaction(
        session, test_workspace.id, test_user.id,
        _create(
            account,
            category_splits=[
                CategorySplitInput(category_id=a.id, amount=Decimal("30")),
                CategorySplitInput(category_id=b.id, amount=Decimal("70")),
            ],
        ),
    )
    assert tx.category_id == b.id  # the largest part is the main category
    assert sum(p.amount for p in tx.category_splits) == Decimal("100")

    updated = await update_transaction(
        session, tx.id, test_workspace.id, test_user.id,
        TransactionUpdate(amount=Decimal("200")),
    )
    assert sorted(p.amount for p in updated.category_splits) == [Decimal("60.00"), Decimal("140.00")]

    cleared = await update_transaction(
        session, tx.id, test_workspace.id, test_user.id,
        TransactionUpdate(category_splits=[]),
    )
    assert cleared.category_splits == []


@pytest.mark.asyncio
async def test_budget_counts_each_category_part(
    session, test_user, test_workspace, account, test_categories
):
    a, b = test_categories[0], test_categories[1]
    month_start = app_today().replace(day=1)
    for category in (a, b):
        session.add(
            Budget(
                user_id=test_user.id,
                workspace_id=test_workspace.id,
                category_id=category.id,
                amount=Decimal("1000"),
                month=month_start,
            )
        )
    await session.commit()

    await create_transaction(
        session, test_workspace.id, test_user.id,
        _create(
            account,
            date=month_start,
            category_splits=[
                CategorySplitInput(category_id=a.id, amount=Decimal("30")),
                CategorySplitInput(category_id=b.id, amount=Decimal("70")),
            ],
        ),
    )

    comparison = await get_budget_vs_actual(session, test_workspace.id, test_user.id, month_start)
    actual = {str(r.category_id): Decimal(str(r.actual_amount)) for r in comparison}
    assert actual[str(a.id)] == Decimal("30")
    assert actual[str(b.id)] == Decimal("70")
