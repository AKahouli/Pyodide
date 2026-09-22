"""Phase 4 bounded index reads. Service-internal only (P4.1-P4.21).

Every read binds to a caller-supplied, verified ``(workspaceId, fileName)``
scope and resolves through the adapter first: ambiguous or unresolved scopes
return an explicit resolution, never another document's content. Actor-to-scope
authorization is enforced by the service-key caller (NestJS) the same way it
is for discovery admission; the runtime never searches beyond the supplied
scope and never accepts a bare index ``documentPk``. No route starts a job and
no route parses a file.
"""

from __future__ import annotations

import os
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from app.datasource.logical_index import (ReadOnlyIndexError, detect_capabilities,
                                          resolve_document_candidates)
from app.datasource.logical_search import (MAX_SEARCH_HITS, LogicalSearchError, search_exact,
                                           search_lexical)
from app.datasource.section_reader import (MAX_BLOCKS, MAX_CLOSURE_SECTIONS, MAX_EVIDENCE_BLOCKS,
                                           MAX_EVIDENCE_CHARS, MAX_OUTLINE_NODES, SectionReadError,
                                           get_outline, read_evidence, read_sections)

router = APIRouter(prefix="/v1/semantic-model-datasource", tags=["index"])


class IndexScope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    actor_user_id: str = Field(alias="actorUserId", min_length=1, max_length=200)
    workspace_id: str = Field(alias="workspaceId", min_length=1, max_length=200)
    file_name: str = Field(alias="fileName", min_length=1, max_length=500)
    uploader_user_id: str | None = Field(default=None, alias="uploaderUserId", max_length=200)


class OutlineBody(IndexScope):
    max_nodes: int = Field(default=MAX_OUTLINE_NODES, alias="maxNodes", ge=1, le=MAX_OUTLINE_NODES)


class SearchBody(IndexScope):
    method: Literal["exact", "lexical"] = "exact"
    value: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=25, ge=1, le=MAX_SEARCH_HITS)


class SectionsBody(IndexScope):
    section_pks: list[int] = Field(alias="sectionPks", min_length=1, max_length=MAX_CLOSURE_SECTIONS)
    include_descendants: bool = Field(default=False, alias="includeDescendants")
    max_blocks: int = Field(default=MAX_BLOCKS, alias="maxBlocks", ge=1, le=MAX_BLOCKS)
    offset: int = Field(default=0, ge=0)


class EvidenceBody(IndexScope):
    block_pks: list[int] = Field(alias="blockPks", min_length=1, max_length=MAX_EVIDENCE_BLOCKS)
    max_chars: int = Field(default=MAX_EVIDENCE_CHARS, alias="maxChars", ge=1,
                           le=MAX_EVIDENCE_CHARS)


def _pool(request: Request):  # type: ignore[no-untyped-def]
    if os.environ.get("SEMANTIC_MODEL_RUNTIME_ENABLED") != "true":
        raise HTTPException(status_code=503, detail="runtime_unavailable")
    pool = getattr(request.app.state, "index_pool", None)
    if pool is None:
        raise HTTPException(status_code=503, detail="index_unavailable")
    return pool


async def _execute(pool: Any, scope: IndexScope, operation):  # type: ignore[no-untyped-def]
    """Resolve the verified scope, then run the operation under one lease."""
    try:
        async with pool.acquire() as connection:
            resolution = await resolve_document_candidates(
                connection, workspace_id=scope.workspace_id, file_name=scope.file_name,
                uploader_user_id=scope.uploader_user_id)
            if resolution["resolution"] != "resolved":
                return {"resolution": resolution["resolution"],
                        "candidates": resolution["candidates"]}
            document_pk = resolution["candidates"][0]["documentPk"]
            result = await operation(connection, document_pk)
            return {"resolution": "resolved", **result}
    except (ReadOnlyIndexError, LogicalSearchError, SectionReadError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/documents/outline")
async def document_outline(body: OutlineBody, request: Request) -> dict[str, object]:
    return await _execute(_pool(request), body,
                          lambda conn, pk: get_outline(conn, document_pk=pk,
                                                       max_nodes=body.max_nodes))


@router.post("/documents/search")
async def document_search(body: SearchBody, request: Request) -> dict[str, object]:
    async def operation(connection: Any, document_pk: int | str) -> dict[str, Any]:
        if body.method == "lexical":
            manifest = await detect_capabilities(connection)
            return await search_lexical(connection, document_pk=document_pk, query=body.value,
                                        capabilities=manifest["capabilities"], limit=body.limit)
        return await search_exact(connection, document_pk=document_pk, value=body.value,
                                  limit=body.limit)

    return await _execute(_pool(request), body, operation)


@router.post("/documents/sections/read")
async def document_sections_read(body: SectionsBody, request: Request) -> dict[str, object]:
    return await _execute(
        _pool(request), body,
        lambda conn, pk: read_sections(conn, document_pk=pk, section_pks=body.section_pks,
                                       include_descendants=body.include_descendants,
                                       max_blocks=body.max_blocks, offset=body.offset))


@router.post("/evidence/read")
async def evidence_read(body: EvidenceBody, request: Request) -> dict[str, object]:
    return await _execute(
        _pool(request), body,
        lambda conn, pk: read_evidence(conn, document_pk=pk, block_pks=body.block_pks,
                                       max_chars=body.max_chars))
