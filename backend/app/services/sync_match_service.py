"""Pairing what the bank delivers with what the user already typed in.

The sync used to merge a bank charge into a manual entry on a loose
description match and otherwise insert a twin. This module keeps the one
case that is safe to settle alone (a single manual entry with the same
amount, a close date and similar wording) and turns every other doubt into
a suggestion the user decides, so money is neither merged nor duplicated
without anyone looking.
"""
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.credit_card_bill import CreditCardBill
from app.models.group_settlement import GroupSettlement
from app.models.invoice import InvoiceAllocation, InvoiceDeduction
from app.models.mortgage_payment_allocation import MortgagePaymentAllocation
from app.models.sync_match_suggestion import (
    STATUS_DECLINED,
    STATUS_PENDING,
    SyncMatchSuggestion,
)
from app.models.transaction import Transaction
from app.services.credit_card_service import apply_effective_date
from app.services.text_similarity import token_overlap

DATE_WINDOW_DAYS = 3
#: Wording at or above this is "the same merchant" for an automatic merge.
STRONG_AFFINITY = 0.6
#: A bank amount may differ from the typed one by a tip, IOF or rounding.
AMOUNT_TOLERANCE_ABS = Decimal("1.00")
AMOUNT_TOLERANCE_REL = Decimal("0.02")
#: Shortest word whose appearance inside another word counts as a hint
#: ("mercado" inside "supermercado"). Shorter ones match by accident.
MIN_CONTAINED_TOKEN = 4

REASON_DESCRIPTION = "description"
REASON_AMOUNT = "amount"
REASON_AMBIGUOUS = "ambiguous"


class MergeBlocked(Exception):
    """The bank row is already tied to something a merge would sever."""


@dataclass
class Candidate:
    transaction: Transaction
    score: float
    reason: str
    strong: bool


@dataclass
class ManualMatch:
    #: Settled alone: the one clear counterpart, or None.
    strong: Optional[Transaction] = None
    #: Worth a human look, best first.
    doubtful: list[Candidate] = field(default_factory=list)


def description_affinity(a: Optional[str], b: Optional[str]) -> float:
    """0..1 closeness of two merchant strings.

    Word overlap is the base. A word of four or more letters that sits
    inside a word of the other string ("mercado" in "supermercado") counts
    as half a match, which is what a short hand-typed name looks like next
    to what the bank prints.
    """
    overlap = token_overlap(a, b)
    if overlap or not a or not b:
        return overlap
    tokens_a = [t for t in a.lower().split() if t]
    tokens_b = [t for t in b.lower().split() if t]
    for ta in tokens_a:
        for tb in tokens_b:
            shorter, longer = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
            if len(shorter) >= MIN_CONTAINED_TOKEN and shorter in longer:
                return 0.5
    return 0.0


def _amount_close(candidate: Decimal, incoming: Decimal) -> bool:
    tolerance = max(AMOUNT_TOLERANCE_ABS, abs(incoming) * AMOUNT_TOLERANCE_REL)
    return abs(candidate - incoming) <= tolerance


def _affinity(candidate: Transaction, txn_data) -> float:
    return max(
        description_affinity(candidate.original_description or candidate.description, txn_data.description),
        description_affinity(candidate.description, txn_data.description),
        description_affinity(candidate.payee, getattr(txn_data, "payee", None)),
    )


async def find_manual_match(
    session: AsyncSession,
    account_id: uuid.UUID,
    txn_data,
    *,
    exclude_ids: set[uuid.UUID] | frozenset[uuid.UUID] = frozenset(),
) -> ManualMatch:
    """Classify the manual entries that could be this bank charge."""
    result = await session.execute(
        select(Transaction).where(
            Transaction.account_id == account_id,
            Transaction.external_id.is_(None),
            Transaction.source == "manual",
            Transaction.is_ignored.is_(False),
            Transaction.type == txn_data.type,
            Transaction.date >= txn_data.date - timedelta(days=DATE_WINDOW_DAYS),
            Transaction.date <= txn_data.date + timedelta(days=DATE_WINDOW_DAYS),
        )
    )
    candidates: list[Candidate] = []
    for tx in result.scalars():
        if tx.id in exclude_ids or not _amount_close(tx.amount, txn_data.amount):
            continue
        affinity = _affinity(tx, txn_data)
        exact = tx.amount == txn_data.amount
        days = abs((tx.date - txn_data.date).days)
        closeness = 1 - days / (DATE_WINDOW_DAYS + 1)
        score = round(0.7 * affinity + 0.3 * closeness, 4)

        if exact and affinity >= STRONG_AFFINITY:
            candidates.append(Candidate(tx, score, REASON_DESCRIPTION, strong=True))
        elif exact and (affinity > 0 or days <= 1):
            # Same amount, wording differs: only worth asking when the
            # wording gives a hint, or the date is as good as equal.
            candidates.append(Candidate(tx, score, REASON_DESCRIPTION, strong=False))
        elif not exact and affinity >= STRONG_AFFINITY:
            candidates.append(Candidate(tx, score, REASON_AMOUNT, strong=False))

    candidates.sort(key=lambda c: c.score, reverse=True)
    strong = [c for c in candidates if c.strong]
    if len(strong) == 1 and (len(candidates) == 1 or candidates[0] is strong[0]):
        # One clear match, and nothing doubtful outscores it.
        return ManualMatch(strong=strong[0].transaction, doubtful=[])
    if len(strong) > 1 and strong[0].score > strong[1].score and candidates[0] is strong[0]:
        return ManualMatch(strong=strong[0].transaction, doubtful=[])
    if len(candidates) > 1:
        for c in candidates:
            c.reason = REASON_AMBIGUOUS
    return ManualMatch(strong=None, doubtful=candidates)


async def _already_asked(
    session: AsyncSession, manual_id: uuid.UUID, synced_id: uuid.UUID
) -> bool:
    found = await session.execute(
        select(SyncMatchSuggestion.id).where(
            SyncMatchSuggestion.manual_transaction_id == manual_id,
            SyncMatchSuggestion.synced_transaction_id == synced_id,
        )
    )
    return found.first() is not None


async def record_suggestions(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    synced: Transaction,
    doubtful: list[Candidate],
) -> int:
    """Store one suggestion per doubtful candidate for a freshly inserted bank row."""
    created = 0
    for candidate in doubtful:
        if await _already_asked(session, candidate.transaction.id, synced.id):
            continue
        session.add(
            SyncMatchSuggestion(
                workspace_id=workspace_id,
                account_id=synced.account_id,
                manual_transaction_id=candidate.transaction.id,
                synced_transaction_id=synced.id,
                score=candidate.score,
                reason=candidate.reason,
                status=STATUS_PENDING,
            )
        )
        created += 1
    if created:
        await session.flush()
    return created


async def list_pending(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    *,
    account_id: Optional[uuid.UUID] = None,
) -> list[SyncMatchSuggestion]:
    query = (
        select(SyncMatchSuggestion)
        .where(
            SyncMatchSuggestion.workspace_id == workspace_id,
            SyncMatchSuggestion.status == STATUS_PENDING,
        )
        .order_by(SyncMatchSuggestion.created_at.desc())
    )
    if account_id is not None:
        query = query.where(SyncMatchSuggestion.account_id == account_id)
    return list((await session.execute(query)).scalars().all())


async def count_pending(session: AsyncSession, workspace_id: uuid.UUID) -> int:
    result = await session.execute(
        select(func.count(SyncMatchSuggestion.id)).where(
            SyncMatchSuggestion.workspace_id == workspace_id,
            SyncMatchSuggestion.status == STATUS_PENDING,
        )
    )
    return int(result.scalar_one())


async def get_suggestion(
    session: AsyncSession, suggestion_id: uuid.UUID, workspace_id: uuid.UUID
) -> Optional[SyncMatchSuggestion]:
    result = await session.execute(
        select(SyncMatchSuggestion).where(
            SyncMatchSuggestion.id == suggestion_id,
            SyncMatchSuggestion.workspace_id == workspace_id,
        )
    )
    return result.scalar_one_or_none()


async def decline(session: AsyncSession, suggestion: SyncMatchSuggestion) -> None:
    suggestion.status = STATUS_DECLINED
    suggestion.resolved_at = datetime.now(timezone.utc)
    await session.flush()


async def _is_tied_down(session: AsyncSession, transaction_id: uuid.UUID) -> bool:
    """True when something else points at the row and deleting it would cut that link."""
    checks = (
        select(InvoiceAllocation.id).where(InvoiceAllocation.transaction_id == transaction_id),
        select(InvoiceDeduction.id).where(InvoiceDeduction.transaction_id == transaction_id),
        select(GroupSettlement.id).where(
            or_(
                GroupSettlement.transaction_id == transaction_id,
                GroupSettlement.receiver_transaction_id == transaction_id,
            )
        ),
        select(MortgagePaymentAllocation.id).where(
            or_(
                MortgagePaymentAllocation.payment_transaction_id == transaction_id,
                MortgagePaymentAllocation.loan_transaction_id == transaction_id,
            )
        ),
    )
    for check in checks:
        if (await session.execute(check.limit(1))).first() is not None:
            return True
    return False


async def merge(session: AsyncSession, suggestion: SyncMatchSuggestion) -> Transaction:
    """Fold the bank row into the manual one and keep the manual one.

    The user's entry keeps its category, notes, tags and purchase date. The
    bank supplies what only it knows: its id, status, amount, bill and raw
    payload. The bank row is then deleted, so the charge exists once.
    """
    manual = await session.get(Transaction, suggestion.manual_transaction_id)
    synced = await session.get(Transaction, suggestion.synced_transaction_id)
    if manual is None or synced is None:
        raise MergeBlocked("One of the two transactions no longer exists")
    if await _is_tied_down(session, synced.id):
        raise MergeBlocked(
            "The bank transaction is already linked to an invoice, loan payment or settlement"
        )

    carried = {
        "external_id": synced.external_id,
        "raw_data": synced.raw_data,
        "status": synced.status,
        "amount": synced.amount,
        "currency": synced.currency,
        "amount_primary": synced.amount_primary,
        "fx_rate_used": synced.fx_rate_used,
        "bill_id": synced.bill_id,
        "installment_number": synced.installment_number,
        "total_installments": synced.total_installments,
        "installment_total_amount": synced.installment_total_amount,
        "installment_purchase_date": synced.installment_purchase_date,
        "transfer_pair_id": synced.transfer_pair_id,
    }
    original_description = synced.original_description or synced.description
    payee, payee_id = synced.payee, synced.payee_id
    recurring_id = synced.recurring_transaction_id

    # Free the bank row's idempotency key before the manual row takes it.
    await session.execute(
        delete(SyncMatchSuggestion).where(
            or_(
                SyncMatchSuggestion.synced_transaction_id == synced.id,
                SyncMatchSuggestion.manual_transaction_id == manual.id,
            )
        )
    )
    await session.delete(synced)
    await session.flush()

    for name, value in carried.items():
        if name == "transfer_pair_id" and value is None:
            continue
        setattr(manual, name, value)
    manual.source = "sync"
    if manual.original_description is None:
        manual.original_description = original_description
    if payee and not manual.payee:
        manual.payee = payee
    if payee_id and manual.payee_id is None:
        manual.payee_id = payee_id
    if recurring_id and manual.recurring_transaction_id is None:
        manual.recurring_transaction_id = recurring_id

    account = await session.get(Account, manual.account_id)
    if manual.effective_bill_date is None:
        bill = await session.get(CreditCardBill, manual.bill_id) if manual.bill_id else None
        apply_effective_date(manual, account, bill_due_date=bill.due_date if bill else None)
    await session.flush()
    return manual
