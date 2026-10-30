"""Bill summaries: the bank's total against the app's, and the payments that settled it."""
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.credit_card_bill import CreditCardBill
from app.models.transaction import Transaction
from app.services import bill_summary_service as svc

TODAY = date(2026, 10, 29)


async def _card(session, user, name="Visa"):
    account = Account(
        id=uuid.uuid4(), user_id=user.id, name=name, type="credit_card",
        balance=Decimal("0"), currency="BRL", masked_number="4711",
    )
    session.add(account)
    await session.flush()
    return account


async def _bill(session, user, account, due, total):
    bill = CreditCardBill(
        id=uuid.uuid4(), user_id=user.id, account_id=account.id,
        external_id=f"b-{uuid.uuid4().hex[:6]}", due_date=due,
        total_amount=Decimal(total), currency="BRL",
    )
    session.add(bill)
    await session.flush()
    return bill


async def _tx(session, user, account, *, day, amount, type="debit", bill=None, raw=None, pair=None,
              description="x", ignored=False):
    tx = Transaction(
        id=uuid.uuid4(), user_id=user.id, account_id=account.id, description=description,
        amount=Decimal(amount), date=day, type=type, source="sync",
        external_id=f"t-{uuid.uuid4().hex[:8]}", bill_id=bill.id if bill else None,
        raw_data=raw, transfer_pair_id=pair, is_ignored=ignored,
        created_at=datetime.now(timezone.utc),
    )
    session.add(tx)
    await session.flush()
    return tx


def _payment_tx(**kw):
    return Transaction(type="credit", raw_data=kw.get("raw"), transfer_pair_id=kw.get("pair"))


def test_payment_detection():
    assert svc.is_bill_payment(_payment_tx(pair=uuid.uuid4()))
    assert svc.is_bill_payment(_payment_tx(raw={"category": "Credit card payment"}))
    assert svc.is_bill_payment(_payment_tx(raw={"operationType": "PAGAMENTO_FATURA"}))
    # a refund is not a payment, even if something paired it by accident
    assert not svc.is_bill_payment(_payment_tx(raw={"operationType": "ESTORNO"}, pair=uuid.uuid4()))
    assert not svc.is_bill_payment(_payment_tx())
    assert not svc.is_bill_payment(Transaction(type="debit", transfer_pair_id=uuid.uuid4()))


@pytest.mark.asyncio
async def test_total_adds_charges_minus_refunds_and_ignores_payments(
    session: AsyncSession, test_user, test_workspace
):
    card = await _card(session, test_user)
    bill = await _bill(session, test_user, card, date(2026, 10, 20), "150.00")
    await _tx(session, test_user, card, day=date(2026, 9, 25), amount="100.00", bill=bill)
    await _tx(session, test_user, card, day=date(2026, 9, 26), amount="70.00", bill=bill)
    await _tx(session, test_user, card, day=date(2026, 9, 27), amount="20.00", type="credit",
              bill=bill, raw={"operationType": "ESTORNO"})
    await _tx(session, test_user, card, day=date(2026, 9, 28), amount="999.00", type="credit",
              bill=bill, pair=uuid.uuid4())  # a payment linked to this bill
    await _tx(session, test_user, card, day=date(2026, 9, 28), amount="500.00", bill=bill,
              ignored=True)

    [summary] = await svc.summarize_bills(session, test_workspace.id, today=TODAY)

    assert summary.bank_total == Decimal("150.00")
    assert summary.app_total == Decimal("150.00")
    assert summary.matches and summary.difference == 0
    assert summary.transactions_count == 3


@pytest.mark.asyncio
async def test_difference_is_reported_not_hidden(session: AsyncSession, test_user, test_workspace):
    card = await _card(session, test_user)
    bill = await _bill(session, test_user, card, date(2026, 10, 20), "200.00")
    await _tx(session, test_user, card, day=date(2026, 9, 25), amount="150.00", bill=bill)

    [summary] = await svc.summarize_bills(session, test_workspace.id, today=TODAY)

    assert not summary.matches
    assert summary.difference == Decimal("50.00")


@pytest.mark.asyncio
async def test_payment_goes_to_the_nearest_bill_whatever_bill_it_is_linked_to(
    session: AsyncSession, test_user, test_workspace
):
    """A bank may link a payment to the next bill; the due date decides."""
    card = await _card(session, test_user)
    september = await _bill(session, test_user, card, date(2026, 9, 20), "300.00")
    october = await _bill(session, test_user, card, date(2026, 10, 20), "400.00")
    await _tx(session, test_user, card, day=date(2026, 9, 19), amount="300.00", type="credit",
              bill=october, pair=uuid.uuid4(), description="Pagamento recebido")
    await _tx(session, test_user, card, day=date(2026, 10, 19), amount="400.00", type="credit",
              bill=october, pair=uuid.uuid4())

    by_id = {s.id: s for s in await svc.summarize_bills(session, test_workspace.id, today=TODAY)}

    assert by_id[september.id].paid_amount == Decimal("300.00")
    assert by_id[september.id].status == svc.STATUS_PAID
    assert [p.description for p in by_id[september.id].payments] == ["Pagamento recebido"]
    assert by_id[october.id].paid_amount == Decimal("400.00")
    assert by_id[october.id].status == svc.STATUS_PAID


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "due, total, paid, status",
    [
        (date(2026, 10, 20), "400.00", "400.00", svc.STATUS_PAID),
        (date(2026, 10, 20), "400.00", "399.97", svc.STATUS_PAID),  # banks round per line
        (date(2026, 10, 20), "400.00", "150.00", svc.STATUS_PARTIAL),
        (date(2026, 10, 20), "400.00", None, svc.STATUS_UNPAID),  # past due, no payment found
        (date(2026, 11, 20), "400.00", None, svc.STATUS_OPEN),  # still to come
        (date(2026, 10, 20), "0.00", None, svc.STATUS_ZERO),
    ],
)
async def test_status(session: AsyncSession, test_user, test_workspace, due, total, paid, status):
    card = await _card(session, test_user)
    await _bill(session, test_user, card, due, total)
    if paid:
        await _tx(session, test_user, card, day=due, amount=paid, type="credit", pair=uuid.uuid4())

    [summary] = await svc.summarize_bills(session, test_workspace.id, today=TODAY)

    assert summary.status == status


@pytest.mark.asyncio
async def test_payment_far_from_any_due_date_is_not_attributed(
    session: AsyncSession, test_user, test_workspace
):
    card = await _card(session, test_user)
    await _bill(session, test_user, card, date(2026, 10, 20), "400.00")
    await _tx(session, test_user, card, day=date(2026, 6, 1), amount="400.00", type="credit",
              pair=uuid.uuid4())

    [summary] = await svc.summarize_bills(session, test_workspace.id, today=TODAY)

    assert summary.paid_amount == 0 and summary.payments == []


@pytest.mark.asyncio
async def test_only_credit_cards_of_the_workspace(session: AsyncSession, test_user, test_workspace):
    card = await _card(session, test_user)
    await _bill(session, test_user, card, date(2026, 10, 20), "10.00")
    checking = Account(
        id=uuid.uuid4(), user_id=test_user.id, name="Checking", type="checking",
        balance=Decimal("0"), currency="BRL",
    )
    session.add(checking)
    await session.flush()
    await _bill(session, test_user, checking, date(2026, 10, 20), "99.00")

    summaries = await svc.summarize_bills(session, test_workspace.id, today=TODAY)
    assert [s.account_id for s in summaries] == [card.id]
    assert await svc.summarize_bills(session, uuid.uuid4(), today=TODAY) == []


@pytest.mark.asyncio
async def test_api_lists_bills_and_filters_by_account(
    client: AsyncClient, auth_headers, session: AsyncSession, test_user, test_workspace
):
    first = await _card(session, test_user, "First")
    second = await _card(session, test_user, "Second")
    await _bill(session, test_user, first, date(2026, 10, 20), "10.00")
    await _bill(session, test_user, second, date(2026, 10, 21), "20.00")
    first_id = str(first.id)
    await session.commit()

    everything = await client.get("/api/credit-card-bills", headers=auth_headers)
    only_first = await client.get(
        "/api/credit-card-bills", params={"account_id": first_id}, headers=auth_headers
    )

    assert everything.status_code == 200
    assert {row["account_name"] for row in everything.json()} == {"First", "Second"}
    assert [row["account_name"] for row in only_first.json()] == ["First"]
    row = only_first.json()[0]
    assert row["bank_total"] == 10.0 and row["status"] in {"open", "unpaid"}


@pytest.mark.asyncio
async def test_pending_twin_of_a_confirmed_payment_is_not_counted_twice(
    session: AsyncSession, test_user, test_workspace
):
    """Some banks show one payment as confirmed and again as pending."""
    card = await _card(session, test_user)
    bill = await _bill(session, test_user, card, date(2026, 10, 20), "400.00")
    await _tx(session, test_user, card, day=date(2026, 10, 20), amount="400.00", type="credit",
              bill=bill, raw={"operationType": "PAGAMENTO_FATURA"}, description="Pagamento recebido")
    twin = await _tx(session, test_user, card, day=date(2026, 10, 20), amount="400.00", type="credit",
                     pair=uuid.uuid4(), description="PAGAMENTO COM SALDO")
    twin.status = "pending"
    await session.flush()

    [summary] = await svc.summarize_bills(session, test_workspace.id, today=TODAY)

    assert summary.paid_amount == Decimal("400.00")
    assert [p.description for p in summary.payments] == ["Pagamento recebido"]


@pytest.mark.asyncio
async def test_a_pending_payment_alone_still_counts(session: AsyncSession, test_user, test_workspace):
    card = await _card(session, test_user)
    await _bill(session, test_user, card, date(2026, 10, 20), "400.00")
    only = await _tx(session, test_user, card, day=date(2026, 10, 20), amount="400.00", type="credit",
                     pair=uuid.uuid4())
    only.status = "pending"
    await session.flush()

    [summary] = await svc.summarize_bills(session, test_workspace.id, today=TODAY)

    assert summary.paid_amount == Decimal("400.00")


@pytest.mark.asyncio
async def test_two_confirmed_payments_of_the_same_amount_days_apart_are_one(
    session: AsyncSession, test_user, test_workspace
):
    """Itaú lists a payment as "Pagamento recebido" and again as "PAGAMENTO COM SALDO"."""
    card = await _card(session, test_user)
    await _bill(session, test_user, card, date(2026, 9, 21), "400.00")
    await _tx(session, test_user, card, day=date(2026, 9, 22), amount="400.00", type="credit",
              pair=uuid.uuid4(), raw={"operationType": "OUTROS"}, description="PAGAMENTO COM SALDO")
    await _tx(session, test_user, card, day=date(2026, 9, 21), amount="400.00", type="credit",
              raw={"operationType": "PAGAMENTO_FATURA"}, description="Pagamento recebido")

    [summary] = await svc.summarize_bills(session, test_workspace.id, today=TODAY)

    assert summary.paid_amount == Decimal("400.00")
    assert [p.description for p in summary.payments] == ["Pagamento recebido"]


@pytest.mark.asyncio
async def test_payments_of_different_amounts_are_both_counted(
    session: AsyncSession, test_user, test_workspace
):
    card = await _card(session, test_user)
    await _bill(session, test_user, card, date(2026, 9, 21), "400.00")
    await _tx(session, test_user, card, day=date(2026, 9, 20), amount="150.00", type="credit", pair=uuid.uuid4())
    await _tx(session, test_user, card, day=date(2026, 9, 21), amount="250.00", type="credit", pair=uuid.uuid4())

    [summary] = await svc.summarize_bills(session, test_workspace.id, today=TODAY)

    assert summary.paid_amount == Decimal("400.00") and summary.status == svc.STATUS_PAID
