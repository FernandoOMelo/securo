"""What each credit-card bill is, what was paid against it, and whether it adds up.

The bank reports a bill's total. The app holds the charges linked to it. The
two rarely agree to the cent, and the gap is the useful part: history from
before the sync began, installments the bank bills separately and fees all
show up as a difference, so it is reported, never hidden or "fixed".

Payments arrive on their own with a bank connection (a credit on the card
paired with the debit on the checking account), so nothing here records a
payment. A credit counts as a bill payment when it is paired as a transfer or
the bank itself categorized it that way, and it is attributed to the nearest
bill by due date rather than to the bill row it happens to be linked to: some
banks link a payment to the bill it settles, others to the next one.
"""
import uuid
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.app_clock import app_today
from app.models.account import Account
from app.models.bank_connection import BankConnection
from app.models.credit_card_bill import CreditCardBill
from app.models.transaction import Transaction

#: A payment can precede the due date by this long and still belong to it.
PAYMENT_DAYS_BEFORE_DUE = 35
#: A late payment still belongs to the bill it was late for.
PAYMENT_DAYS_AFTER_DUE = 10
#: Tolerance for "paid in full" and "adds up": banks round per line.
PAID_TOLERANCE = Decimal("0.05")
MATCH_TOLERANCE = Decimal("0.01")
#: Payments of the same amount this close together are one payment listed twice.
TWIN_PAYMENT_DAYS = 3

STATUS_PAID = "paid"
STATUS_PARTIAL = "partial"
STATUS_OPEN = "open"
STATUS_UNPAID = "unpaid"
STATUS_ZERO = "zero"


@dataclass
class PaymentRef:
    id: uuid.UUID
    date: date
    description: str
    amount: Decimal


@dataclass
class BillSummary:
    id: uuid.UUID
    account_id: uuid.UUID
    account_name: str
    masked_number: Optional[str]
    currency: str
    due_date: date
    bank_total: Decimal
    app_total: Decimal
    difference: Decimal
    matches: bool
    transactions_count: int
    paid_amount: Decimal
    status: str
    payments: list[PaymentRef] = field(default_factory=list)


def is_bill_payment(tx: Transaction) -> bool:
    """A credit on a card that settles a bill, as opposed to a refund."""
    if tx.type != "credit":
        return False
    raw = tx.raw_data if isinstance(tx.raw_data, dict) else {}
    if raw.get("operationType") == "ESTORNO":
        return False
    return (
        tx.transfer_pair_id is not None
        or raw.get("category") == "Credit card payment"
        or raw.get("operationType") == "PAGAMENTO_FATURA"
    )


def _drop_twin_payments(payments: list[Transaction]) -> list[Transaction]:
    """Some banks list one payment twice, on the card and again as a settlement.

    Two payments of the same amount a few days apart are taken as one. The one
    the bank flagged as a bill payment and has confirmed is kept; if nothing
    else says which is real, the earlier one is. Paying the exact same amount
    twice within days is rare enough that merging them beats counting it twice.
    """

    def preference(tx: Transaction) -> tuple:
        raw = tx.raw_data if isinstance(tx.raw_data, dict) else {}
        return (
            tx.status == "pending",
            raw.get("operationType") != "PAGAMENTO_FATURA",
            tx.date,
            str(tx.id),
        )

    kept: list[Transaction] = []
    for tx in sorted(payments, key=preference):
        if not any(
            other.amount == tx.amount and abs((other.date - tx.date).days) <= TWIN_PAYMENT_DAYS
            for other in kept
        ):
            kept.append(tx)
    return kept


def _status(total: Decimal, paid: Decimal, due: date, today: date) -> str:
    if total <= MATCH_TOLERANCE:
        return STATUS_ZERO
    if paid >= total - PAID_TOLERANCE:
        return STATUS_PAID
    if paid > 0:
        return STATUS_PARTIAL
    return STATUS_OPEN if due >= today else STATUS_UNPAID


def _attribute_payments(
    bills: list[CreditCardBill], payments: list[Transaction]
) -> dict[uuid.UUID, list[Transaction]]:
    """Give each payment to the nearest bill whose window it falls in."""
    assigned: dict[uuid.UUID, list[Transaction]] = {bill.id: [] for bill in bills}
    for payment in payments:
        best: Optional[CreditCardBill] = None
        best_gap: Optional[int] = None
        for bill in bills:
            offset = (payment.date - bill.due_date).days
            if not -PAYMENT_DAYS_BEFORE_DUE <= offset <= PAYMENT_DAYS_AFTER_DUE:
                continue
            if best_gap is None or abs(offset) < best_gap:
                best, best_gap = bill, abs(offset)
        if best is not None:
            assigned[best.id].append(payment)
    return assigned


async def summarize_bills(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    *,
    account_id: Optional[uuid.UUID] = None,
    limit_per_account: int = 24,
    today: Optional[date] = None,
) -> list[BillSummary]:
    """Bills of the workspace's credit cards, newest due date first."""
    today = today or app_today()
    account_query = (
        select(Account)
        .outerjoin(BankConnection, Account.connection_id == BankConnection.id)
        .where(
            Account.type == "credit_card",
            or_(
                Account.workspace_id == workspace_id,
                BankConnection.workspace_id == workspace_id,
            ),
        )
    )
    if account_id is not None:
        account_query = account_query.where(Account.id == account_id)
    accounts = list((await session.execute(account_query)).scalars().all())

    summaries: list[BillSummary] = []
    for account in accounts:
        bills = list(
            (
                await session.execute(
                    select(CreditCardBill)
                    .where(CreditCardBill.account_id == account.id)
                    .order_by(CreditCardBill.due_date.desc())
                    .limit(limit_per_account)
                )
            )
            .scalars()
            .all()
        )
        if not bills:
            continue
        oldest = min(bill.due_date for bill in bills)
        txs = list(
            (
                await session.execute(
                    select(Transaction).where(
                        Transaction.account_id == account.id,
                        Transaction.is_ignored.is_(False),
                        or_(
                            Transaction.bill_id.in_([bill.id for bill in bills]),
                            (Transaction.type == "credit")
                            & (Transaction.date >= oldest - timedelta(days=PAYMENT_DAYS_BEFORE_DUE)),
                        ),
                    )
                )
            )
            .scalars()
            .all()
        )
        payments = _drop_twin_payments([tx for tx in txs if is_bill_payment(tx)])
        attributed = _attribute_payments(bills, payments)

        for bill in bills:
            linked = [tx for tx in txs if tx.bill_id == bill.id and not is_bill_payment(tx)]
            charges = sum((tx.amount for tx in linked if tx.type == "debit"), Decimal("0"))
            refunds = sum((tx.amount for tx in linked if tx.type == "credit"), Decimal("0"))
            app_total = charges - refunds
            paid_txs = sorted(attributed[bill.id], key=lambda tx: tx.date)
            paid = sum((tx.amount for tx in paid_txs), Decimal("0"))
            difference = bill.total_amount - app_total
            summaries.append(
                BillSummary(
                    id=bill.id,
                    account_id=account.id,
                    account_name=account.display_name or account.name,
                    masked_number=account.masked_number,
                    currency=bill.currency,
                    due_date=bill.due_date,
                    bank_total=bill.total_amount,
                    app_total=app_total,
                    difference=difference,
                    matches=abs(difference) < MATCH_TOLERANCE,
                    transactions_count=len(linked),
                    paid_amount=paid,
                    status=_status(bill.total_amount, paid, bill.due_date, today),
                    payments=[
                        PaymentRef(tx.id, tx.date, tx.description, tx.amount) for tx in paid_txs
                    ],
                )
            )
    summaries.sort(key=lambda s: (s.due_date, s.account_name), reverse=True)
    return summaries
