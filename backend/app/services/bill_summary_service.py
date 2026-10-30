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
import calendar
import unicodedata
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

#: With no closing day on the card, the open bill is assumed to cover what was
#: bought from this long before the last due date (cards close about a week ahead).
OPEN_BILL_LOOKBACK_DAYS = 7
_OPEN_BILL_NAMESPACE = uuid.UUID("5d1e9a52-0f55-4a5c-9a43-3b6f1e4f9c10")

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
    #: The bank gave no usable total, so `bank_total` is worked out from the
    #: charges the app holds. There is nothing to compare it against.
    estimated: bool = False


#: How banks word a bill payment on the card, for the rows that arrive without a
#: transfer pair or a category (Itaú's "PAGAMENTO COM SALDO" is one).
_PAYMENT_WORDING = (
    "pagamento recebido",
    "pagamento de fatura",
    "pagamento fatura",
    "pagamento com saldo",
    "inclusao de pagamento",
)


def _plain(text: Optional[str]) -> str:
    return unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()


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
        or any(wording in _plain(tx.description) for wording in _PAYMENT_WORDING)
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


def _clamp_day(year: int, month: int, day: int) -> date:
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def _next_due_date(last_due: date, due_day: int, today: date) -> date:
    """The first due date after `last_due` that is not already in the past."""
    year, month = last_due.year, last_due.month
    while True:
        month += 1
        if month > 12:
            year, month = year + 1, 1
        candidate = _clamp_day(year, month, due_day)
        if candidate > last_due and candidate >= today:
            return candidate


def _open_bill_start(last_due: date, close_day: Optional[int]) -> date:
    """First day of the cycle that no bank bill covers yet."""
    if close_day:
        close = _clamp_day(last_due.year, last_due.month, close_day)
        if close > last_due:
            month = last_due.month - 1 or 12
            year = last_due.year - 1 if last_due.month == 1 else last_due.year
            close = _clamp_day(year, month, close_day)
        return close
    return last_due - timedelta(days=OPEN_BILL_LOOKBACK_DAYS)


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


async def _open_bill(
    session: AsyncSession, account: Account, bills: list[CreditCardBill], today: date
) -> Optional[BillSummary]:
    """The bill that is still being filled, when the bank has not sent it yet.

    Banks send a bill once it closes, so right after one is due there is no row
    for the next. What the card owes meanwhile is what was charged and not yet
    on any bill. Stale pending rows and installments dated ahead are left out.
    """
    if not account.payment_due_day:
        return None
    newest = max(bills, key=lambda bill: bill.due_date)
    if newest.due_date >= today:
        return None

    start = _open_bill_start(newest.due_date, account.statement_close_day)
    rows = (
        await session.execute(
            select(Transaction).where(
                Transaction.account_id == account.id,
                Transaction.bill_id.is_(None),
                Transaction.is_ignored.is_(False),
                Transaction.source != "opening_balance",
                Transaction.date >= start,
                Transaction.date <= today,
            )
        )
    ).scalars().all()
    charged = [tx for tx in rows if not is_bill_payment(tx)]
    total = sum((tx.amount for tx in charged if tx.type == "debit"), Decimal("0")) - sum(
        (tx.amount for tx in charged if tx.type == "credit"), Decimal("0")
    )
    # Credits beyond the charges leave a balance in the card's favour, not a negative bill.
    total = max(total, Decimal("0"))
    due = _next_due_date(newest.due_date, account.payment_due_day, today)
    return BillSummary(
        id=uuid.uuid5(_OPEN_BILL_NAMESPACE, str(account.id)),
        account_id=account.id,
        account_name=account.display_name or account.name,
        masked_number=account.masked_number,
        currency=newest.currency,
        due_date=due,
        bank_total=total,
        app_total=total,
        difference=Decimal("0"),
        matches=False,
        transactions_count=len(charged),
        paid_amount=Decimal("0"),
        status=_status(total, Decimal("0"), due, today),
        estimated=True,
    )


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
            # A bank that reports zero for a bill that has charges has not filled
            # the total in (Mercado Pago does, for a bill it already closed): the
            # charges are the best figure there is, and they are said to be one.
            estimated = bill.total_amount <= MATCH_TOLERANCE and app_total > MATCH_TOLERANCE
            total = app_total if estimated else bill.total_amount
            difference = Decimal("0") if estimated else bill.total_amount - app_total
            summaries.append(
                BillSummary(
                    id=bill.id,
                    account_id=account.id,
                    account_name=account.display_name or account.name,
                    masked_number=account.masked_number,
                    currency=bill.currency,
                    due_date=bill.due_date,
                    bank_total=total,
                    app_total=app_total,
                    difference=difference,
                    matches=not estimated and abs(difference) < MATCH_TOLERANCE,
                    transactions_count=len(linked),
                    paid_amount=paid,
                    status=_status(total, paid, bill.due_date, today),
                    payments=[
                        PaymentRef(tx.id, tx.date, tx.description, tx.amount) for tx in paid_txs
                    ],
                    estimated=estimated,
                )
            )

        open_bill = await _open_bill(session, account, bills, today)
        if open_bill is not None:
            summaries.append(open_bill)
    summaries.sort(key=lambda s: (s.due_date, s.account_name), reverse=True)
    return summaries
