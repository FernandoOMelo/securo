"""The everyday list: card charges stay on their bill and a transfer is one line."""
import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.models.account import Account
from app.models.transaction import Transaction


@pytest_asyncio.fixture
async def world(session, test_user):
    async def make_account(name, kind):
        acc = Account(
            id=uuid.uuid4(), user_id=test_user.id,
            name=name, type=kind, balance=Decimal("0"), currency="BRL",
        )
        session.add(acc)
        return acc

    checking = await make_account("Conta", "checking")
    savings = await make_account("Reserva", "savings")
    card = await make_account("Cartão", "credit_card")
    await session.flush()

    pair = uuid.uuid4()

    def tx(account, description, kind, pair_id=None):
        row = Transaction(
            id=uuid.uuid4(), user_id=test_user.id,
            account_id=account.id, description=description, amount=Decimal("100"), currency="BRL",
            date=date(2026, 10, 10), type=kind, source="manual", status="posted",
            transfer_pair_id=pair_id,
        )
        session.add(row)
        return row

    rows = {
        "market": tx(checking, "Mercado", "debit"),
        "charge": tx(card, "Compra no cartão", "debit"),
        "out": tx(checking, "Pix enviado", "debit", pair),
        "in": tx(savings, "Pix recebido", "credit", pair),
    }
    await session.commit()
    return {"accounts": {"checking": checking, "card": card, "savings": savings}, "rows": rows}


async def _descriptions(client: AsyncClient, headers, **params):
    resp = await client.get("/api/transactions", headers=headers, params=params)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return {i["description"] for i in body["items"]}, body


@pytest.mark.asyncio
async def test_default_list_keeps_everything(client, auth_headers, world):
    names, _ = await _descriptions(client, auth_headers)

    assert {"Mercado", "Compra no cartão", "Pix enviado", "Pix recebido"} <= names


@pytest.mark.asyncio
async def test_compact_hides_card_charges_and_the_receiving_leg(client, auth_headers, world):
    names, body = await _descriptions(client, auth_headers, compact="true")

    assert names == {"Mercado", "Pix enviado"}
    assert body["total"] == 2


@pytest.mark.asyncio
async def test_compact_summary_still_counts_card_spending(client, auth_headers, world):
    _, plain = await _descriptions(client, auth_headers)
    _, compact = await _descriptions(client, auth_headers, compact="true")

    assert compact["summary"]["expense"] == plain["summary"]["expense"]
    assert float(compact["summary"]["expense"]) == 200.0  # market + card charge


@pytest.mark.asyncio
async def test_choosing_an_account_brings_its_rows_back(client, auth_headers, world):
    card = world["accounts"]["card"]
    savings = world["accounts"]["savings"]

    card_names, _ = await _descriptions(client, auth_headers, compact="true", account_id=str(card.id))
    savings_names, _ = await _descriptions(client, auth_headers, compact="true", account_id=str(savings.id))

    assert card_names == {"Compra no cartão"}
    assert savings_names == {"Pix recebido"}
