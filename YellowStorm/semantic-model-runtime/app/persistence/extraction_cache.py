"""Reuse what an unchanged document yielded, so large workspaces rerun cheaply."""

from __future__ import annotations

import hashlib
import json
from typing import Any


def _canonical(value: Any) -> Any:
    if isinstance(value, (set, frozenset)):
        return sorted(value, key=str)
    return str(value)


def extraction_cache_key(parts: dict[str, Any]) -> str:
    """Stable key over everything that decides a document's output."""
    body = json.dumps(parts, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      default=_canonical)
    return "sha256:" + hashlib.sha256(body.encode("utf-8")).hexdigest()


class DocumentExtractionCache:
    """Stored per model, concept and document; a newer result replaces the older one."""

    def __init__(self, pool: Any, model_id: str):
        self.pool = pool
        self.model_id = model_id

    async def get(self, key: str) -> dict[str, Any] | None:
        value = await self.pool.fetchval(
            "SELECT output FROM semantic_population.document_extractions WHERE cache_key = $1", key)
        if value is None:
            return None
        return json.loads(value) if isinstance(value, str) else dict(value)

    async def put(self, key: str, *, concept_id: str, asset_id: str, output: dict[str, Any]) -> None:
        body = json.dumps(output, ensure_ascii=False, default=_canonical)
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                await connection.execute(
                    "DELETE FROM semantic_population.document_extractions "
                    "WHERE model_id = $1 AND concept_id = $2 AND asset_id = $3 AND cache_key <> $4",
                    self.model_id, concept_id, asset_id, key)
                await connection.execute(
                    "INSERT INTO semantic_population.document_extractions "
                    "(cache_key, model_id, concept_id, asset_id, output) VALUES ($1, $2, $3, $4, $5::jsonb) "
                    "ON CONFLICT (cache_key) DO UPDATE SET output = EXCLUDED.output, created_at = now()",
                    key, self.model_id, concept_id, asset_id, body)
