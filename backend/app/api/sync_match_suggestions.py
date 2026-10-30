import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_async_session
from app.core.workspace_context import (
    WorkspaceContext,
    current_workspace,
    current_writable_workspace,
)
from app.models.sync_match_suggestion import STATUS_PENDING, SyncMatchSuggestion
from app.models.transaction import Transaction
from app.services import sync_match_service

router = APIRouter(prefix="/api/sync-match-suggestions", tags=["sync match suggestions"])


class SuggestedTransaction(BaseModel):
    id: uuid.UUID
    description: str
    amount: float
    currency: str
    date: date
    status: str
    source: str

    @classmethod
    def of(cls, tx: Transaction) -> "SuggestedTransaction":
        return cls(
            id=tx.id,
            description=tx.description,
            amount=float(tx.amount),
            currency=tx.currency,
            date=tx.date,
            status=tx.status,
            source=tx.source,
        )


class SyncMatchSuggestionRead(BaseModel):
    id: uuid.UUID
    account_id: uuid.UUID
    reason: str
    score: float
    manual: SuggestedTransaction
    synced: SuggestedTransaction


class PendingCount(BaseModel):
    pending: int


def _read(row: SyncMatchSuggestion) -> SyncMatchSuggestionRead:
    return SyncMatchSuggestionRead(
        id=row.id,
        account_id=row.account_id,
        reason=row.reason,
        score=row.score,
        manual=SuggestedTransaction.of(row.manual_transaction),
        synced=SuggestedTransaction.of(row.synced_transaction),
    )


async def _pending_or_404(
    session: AsyncSession, suggestion_id: uuid.UUID, ctx: WorkspaceContext
) -> SyncMatchSuggestion:
    row = await sync_match_service.get_suggestion(session, suggestion_id, ctx.id)
    if row is None or row.status != STATUS_PENDING:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Suggestion not found")
    return row


@router.get("", response_model=list[SyncMatchSuggestionRead])
async def list_suggestions(
    account_id: Optional[uuid.UUID] = Query(None),
    session: AsyncSession = Depends(get_async_session),
    ctx: WorkspaceContext = Depends(current_workspace),
):
    rows = await sync_match_service.list_pending(session, ctx.id, account_id=account_id)
    return [_read(row) for row in rows]


@router.get("/count", response_model=PendingCount)
async def count_suggestions(
    session: AsyncSession = Depends(get_async_session),
    ctx: WorkspaceContext = Depends(current_workspace),
):
    return PendingCount(pending=await sync_match_service.count_pending(session, ctx.id))


@router.post("/{suggestion_id}/merge", status_code=status.HTTP_204_NO_CONTENT)
async def merge_suggestion(
    suggestion_id: uuid.UUID,
    session: AsyncSession = Depends(get_async_session),
    ctx: WorkspaceContext = Depends(current_writable_workspace),
):
    row = await _pending_or_404(session, suggestion_id, ctx)
    try:
        await sync_match_service.merge(session, row)
    except sync_match_service.MergeBlocked as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc))
    await session.commit()


@router.post("/{suggestion_id}/decline", status_code=status.HTTP_204_NO_CONTENT)
async def decline_suggestion(
    suggestion_id: uuid.UUID,
    session: AsyncSession = Depends(get_async_session),
    ctx: WorkspaceContext = Depends(current_writable_workspace),
):
    row = await _pending_or_404(session, suggestion_id, ctx)
    await sync_match_service.decline(session, row)
    await session.commit()
