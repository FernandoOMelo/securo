import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_async_session
from app.core.workspace_context import (
    WorkspaceContext,
    current_workspace,
    current_writable_workspace,
)
from app.models.tag import Tag, transaction_tags
from app.schemas.tag import TagSummary, TagUpdate
from app.services.transaction_extras import normalize_tag_name

router = APIRouter(prefix="/api/tags", tags=["tags"])


@router.get("", response_model=list[TagSummary])
async def list_tags(
    ctx: WorkspaceContext = Depends(current_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    rows = await session.execute(
        select(Tag, func.count(transaction_tags.c.transaction_id))
        .outerjoin(transaction_tags, transaction_tags.c.tag_id == Tag.id)
        .where(Tag.workspace_id == ctx.workspace.id)
        .group_by(Tag.id)
        .order_by(func.lower(Tag.name))
    )
    return [
        TagSummary(id=tag.id, name=tag.name, color=tag.color, transaction_count=count)
        for tag, count in rows.all()
    ]


async def _get_tag(session: AsyncSession, workspace_id: uuid.UUID, tag_id: uuid.UUID) -> Tag:
    tag = (
        await session.execute(
            select(Tag).where(Tag.id == tag_id, Tag.workspace_id == workspace_id)
        )
    ).scalar_one_or_none()
    if tag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    return tag


@router.patch("/{tag_id}", response_model=TagSummary)
async def update_tag(
    tag_id: uuid.UUID,
    data: TagUpdate,
    ctx: WorkspaceContext = Depends(current_writable_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    tag = await _get_tag(session, ctx.workspace.id, tag_id)
    fields = data.model_dump(exclude_unset=True)
    if "name" in fields:
        name = normalize_tag_name(fields["name"])
        if not name:
            raise HTTPException(status_code=400, detail="Name is required")
        clash = (
            await session.execute(
                select(Tag.id).where(
                    Tag.workspace_id == ctx.workspace.id,
                    func.lower(Tag.name) == name.lower(),
                    Tag.id != tag.id,
                )
            )
        ).first()
        if clash:
            raise HTTPException(status_code=409, detail="A tag with this name already exists")
        tag.name = name
    if "color" in fields:
        tag.color = fields["color"]
    await session.commit()
    count = await session.scalar(
        select(func.count()).select_from(transaction_tags).where(transaction_tags.c.tag_id == tag.id)
    )
    return TagSummary(id=tag.id, name=tag.name, color=tag.color, transaction_count=count or 0)


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(
    tag_id: uuid.UUID,
    ctx: WorkspaceContext = Depends(current_writable_workspace),
    session: AsyncSession = Depends(get_async_session),
):
    tag = await _get_tag(session, ctx.workspace.id, tag_id)
    await session.execute(delete(transaction_tags).where(transaction_tags.c.tag_id == tag.id))
    await session.delete(tag)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
