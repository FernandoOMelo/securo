import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_async_session
from app.core.workspace_context import WorkspaceContext, current_workspace
from app.services import bill_summary_service

router = APIRouter(prefix="/api/credit-card-bills", tags=["credit card bills"])


class BillPayment(BaseModel):
    id: uuid.UUID
    date: date
    description: str
    amount: float


class BillSummaryRead(BaseModel):
    id: uuid.UUID
    account_id: uuid.UUID
    account_name: str
    masked_number: Optional[str] = None
    currency: str
    due_date: date
    bank_total: float
    app_total: float
    difference: float
    matches: bool
    transactions_count: int
    paid_amount: float
    status: str
    payments: list[BillPayment]
    estimated: bool = False


@router.get("", response_model=list[BillSummaryRead])
async def list_bills(
    account_id: Optional[uuid.UUID] = Query(None),
    limit_per_account: int = Query(24, ge=1, le=120),
    session: AsyncSession = Depends(get_async_session),
    ctx: WorkspaceContext = Depends(current_workspace),
):
    """Bills of the workspace's credit cards with the bank's total, what the app
    holds for each, and the payments identified against it."""
    summaries = await bill_summary_service.summarize_bills(
        session, ctx.id, account_id=account_id, limit_per_account=limit_per_account
    )
    return [
        BillSummaryRead(
            id=s.id,
            account_id=s.account_id,
            account_name=s.account_name,
            masked_number=s.masked_number,
            currency=s.currency,
            due_date=s.due_date,
            bank_total=float(s.bank_total),
            app_total=float(s.app_total),
            difference=float(s.difference),
            matches=s.matches,
            transactions_count=s.transactions_count,
            paid_amount=float(s.paid_amount),
            status=s.status,
            estimated=s.estimated,
            payments=[
                BillPayment(id=p.id, date=p.date, description=p.description, amount=float(p.amount))
                for p in s.payments
            ],
        )
        for s in summaries
    ]
