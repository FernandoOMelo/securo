"""Form-level extras of a transaction: charge/discount, tags, category parts
and the daily auto-settle.

Kept apart from `transaction_service` so the create, series and update paths
share one implementation of each rule.
"""
import uuid
from decimal import Decimal
from typing import Optional, Sequence

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.app_clock import app_today
from app.models.category import Category
from app.models.tag import Tag
from app.models.transaction import Transaction
from app.models.transaction_category_split import TransactionCategorySplit

_CENT = Decimal("0.01")


def resolve_adjustment(
    base_amount: Decimal,
    adjustment_type: Optional[str],
    adjustment_amount: Optional[Decimal],
) -> dict:
    """Columns that describe an amount with a charge or discount applied.

    ``base_amount`` is the value before the adjustment. The returned ``amount``
    is what the row stores and what every balance and report reads; the
    original and the adjustment are kept so the form can show them again.
    With no adjustment the three adjustment columns are cleared.
    """
    if not adjustment_type or not adjustment_amount:
        return {
            "amount": base_amount,
            "original_amount": None,
            "adjustment_type": None,
            "adjustment_amount": None,
        }
    if adjustment_type not in ("charge", "discount"):
        raise ValueError("adjustment_type must be 'charge' or 'discount'")
    signed = adjustment_amount if adjustment_type == "charge" else -adjustment_amount
    final = base_amount + signed
    if final <= 0:
        raise ValueError("The discount cannot be equal to or greater than the amount")
    return {
        "amount": final,
        "original_amount": base_amount,
        "adjustment_type": adjustment_type,
        "adjustment_amount": adjustment_amount,
    }


def normalize_tag_name(name: str) -> str:
    return name.strip().lstrip("#").strip()[:60]


async def set_tags(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    transaction: Transaction,
    names: Sequence[str],
) -> None:
    """Replace the transaction's tags with ``names`` (created when missing).

    Matching ignores case, so "Viagem" and "viagem" are one tag.
    """
    # Assigning to a collection loads its old value first, which cannot happen
    # lazily in async code; load it explicitly.
    await session.refresh(transaction, ["tags"])
    wanted: dict[str, str] = {}
    for raw in names:
        name = normalize_tag_name(raw)
        if name:
            wanted.setdefault(name.lower(), name)

    existing = (
        await session.execute(select(Tag).where(Tag.workspace_id == workspace_id))
    ).scalars().all()
    by_key = {tag.name.lower(): tag for tag in existing}

    tags: list[Tag] = []
    for key, name in wanted.items():
        tag = by_key.get(key)
        if tag is None:
            tag = Tag(workspace_id=workspace_id, name=name)
            session.add(tag)
            by_key[key] = tag
        tags.append(tag)
    await session.flush()
    transaction.tags = tags


async def set_category_splits(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    transaction: Transaction,
    parts: Sequence,
) -> None:
    """Replace the transaction's category parts.

    Fewer than two parts means no split: the single category (if any) becomes
    the transaction's category. Otherwise the parts must add up to the
    transaction amount, and the largest part's category is kept in
    ``category_id`` so single-category readers stay correct.
    """
    parts = list(parts)
    await session.refresh(transaction, ["category_splits"])
    if len(parts) < 2:
        transaction.category_splits = []
        if parts:
            await _ensure_categories(session, workspace_id, [parts[0].category_id])
            transaction.category_id = parts[0].category_id
        return

    await _ensure_categories(session, workspace_id, [p.category_id for p in parts])
    total = sum((Decimal(p.amount) for p in parts), Decimal("0"))
    if abs(total - Decimal(transaction.amount)) > _CENT:
        raise ValueError("The category parts must add up to the transaction amount")

    transaction.category_splits = [
        TransactionCategorySplit(category_id=p.category_id, amount=p.amount) for p in parts
    ]
    transaction.category_id = max(parts, key=lambda p: Decimal(p.amount)).category_id


async def rescale_category_splits(transaction: Transaction) -> None:
    """Keep the category parts adding up after the amount changed.

    Each part keeps its share of the total; the last part absorbs the
    rounding so the sum is exact.
    """
    parts = list(transaction.category_splits)
    old_total = sum((Decimal(p.amount) for p in parts), Decimal("0"))
    new_total = Decimal(transaction.amount)
    if not parts or old_total <= 0 or old_total == new_total:
        return
    running = Decimal("0")
    for part in parts[:-1]:
        part.amount = (Decimal(part.amount) / old_total * new_total).quantize(_CENT)
        running += part.amount
    parts[-1].amount = new_total - running


async def _ensure_categories(
    session: AsyncSession, workspace_id: uuid.UUID, category_ids: Sequence[uuid.UUID]
) -> None:
    ids = set(category_ids)
    found = (
        await session.execute(
            select(Category.id).where(Category.id.in_(ids), Category.workspace_id == workspace_id)
        )
    ).scalars().all()
    if set(found) != ids:
        raise ValueError("Category not found")


async def settle_due_transactions(session: AsyncSession) -> int:
    """Mark pending "auto-settle" transactions as posted once their date came.

    Runs across every workspace. Returns how many rows were settled. The
    settlement date is the due date: that is the day the money was supposed
    to move.
    """
    today = app_today()
    result = await session.execute(
        update(Transaction)
        .where(
            Transaction.auto_settle.is_(True),
            Transaction.status == "pending",
            Transaction.date <= today,
        )
        .values(status="posted", settled_date=Transaction.date)
    )
    await session.commit()
    return result.rowcount or 0
