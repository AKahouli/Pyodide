"""Reuse what an unchanged document yielded, so large workspaces rerun cheaply."""

from __future__ import annotations

import asyncio
import gzip
import hashlib
import io
import json
import logging
import zlib
from typing import Any

logger = logging.getLogger(__name__)

# A reading larger than this (as JSON) is kept in chunks, with only a pointer in the cache row.
INLINE_MAX_BYTES = 256 * 1024
# Compressed bytes per chunk row.
CHUNK_BYTES = 8 * 1024 * 1024
EXTERNAL_KEY = "$externalOutput"


def _canonical(value: Any) -> Any:
    if isinstance(value, (set, frozenset)):
        return sorted(value, key=str)
    return str(value)


def extraction_cache_key(parts: dict[str, Any]) -> str:
    """Stable key over everything that decides a document's output."""
    body = json.dumps(parts, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      default=_canonical)
    return "sha256:" + hashlib.sha256(body.encode("utf-8")).hexdigest()


class _ChunkSink:
    """Receives a gzip stream and cuts it into chunks, hashing it as it goes."""

    def __init__(self, chunk_bytes: int):
        self.chunk_bytes = chunk_bytes
        self.chunks: list[bytes] = []
        self.digest = hashlib.sha256()
        self.size = 0
        self._buffer = bytearray()

    def write(self, data: bytes) -> int:
        self.digest.update(data)
        self.size += len(data)
        self._buffer.extend(data)
        while len(self._buffer) >= self.chunk_bytes:
            self.chunks.append(bytes(self._buffer[:self.chunk_bytes]))
            del self._buffer[:self.chunk_bytes]
        return len(data)

    def flush(self) -> None:
        pass

    def finish(self) -> None:
        if self._buffer:
            self.chunks.append(bytes(self._buffer))
            self._buffer.clear()


def encode_output(output: dict[str, Any], *, inline_max_bytes: int = INLINE_MAX_BYTES,
                  chunk_bytes: int = CHUNK_BYTES) -> tuple[dict[str, Any], list[bytes]] | None:
    """A large reading as gzip JSON lines (a header line, then one line per output) cut into chunks,
    with its pointer; None when it is small enough to stay in the row."""
    outputs = output.get("outputs")
    if not isinstance(outputs, list):
        return None
    head = json.dumps({name: value for name, value in output.items() if name != "outputs"},
                      ensure_ascii=False, default=_canonical)
    pending = [head]
    size = len(head)
    sink = _ChunkSink(chunk_bytes)
    stream = None
    for item in outputs:
        line = json.dumps(item, ensure_ascii=False, default=_canonical)
        if stream is None:
            pending.append(line)
            size += len(line) + 1
            if size <= inline_max_bytes:
                continue
            stream = gzip.GzipFile(fileobj=sink, mode="wb", compresslevel=4)
            for queued in pending:
                stream.write(queued.encode("utf-8") + b"\n")
            pending = []
        else:
            stream.write(line.encode("utf-8") + b"\n")
    if stream is None:
        return None
    stream.close()
    sink.finish()
    return ({"chunks": len(sink.chunks), "sha256": sink.digest.hexdigest(), "sizeBytes": sink.size,
             "outputs": len(outputs)}, sink.chunks)


def decode_output(pointer: Any, chunks: list[bytes]) -> dict[str, Any] | None:
    """The reading the chunks hold, or None when they do not match the pointer (a miss, not an error)."""
    try:
        if len(chunks) != pointer["chunks"]:
            raise ValueError("chunk_count_mismatch")
        data = b"".join(chunks)
        if hashlib.sha256(data).hexdigest() != pointer["sha256"]:
            raise ValueError("digest_mismatch")
        output: dict[str, Any] | None = None
        outputs: list[Any] = []
        with gzip.open(io.BytesIO(data), "rt", encoding="utf-8") as handle:
            for line in handle:
                if output is None:
                    output = json.loads(line)
                else:
                    outputs.append(json.loads(line))
        if output is None or len(outputs) != pointer["outputs"]:
            raise ValueError("incomplete_reading")
        return {**output, "outputs": outputs}
    except (OSError, EOFError, zlib.error, ValueError, KeyError, TypeError) as exc:
        logger.warning("cached reading unusable", extra={"error": f"{type(exc).__name__}:{exc}"[:200]})
        return None


class DocumentExtractionCache:
    """Stored per model, concept and document; a newer result replaces the older one.

    A reading too large for a row (a sheet of tens of thousands of records) is kept as compressed
    chunks in ``document_extraction_chunks``, written in the same transaction as its row, which
    holds only a pointer. Deleting a row deletes its chunks (foreign key cascade)."""

    def __init__(self, pool: Any, model_id: str, *, inline_max_bytes: int = INLINE_MAX_BYTES,
                 chunk_bytes: int = CHUNK_BYTES):
        self.pool = pool
        self.model_id = model_id
        self.inline_max_bytes = inline_max_bytes
        self.chunk_bytes = chunk_bytes

    async def get(self, key: str) -> dict[str, Any] | None:
        value = await self.pool.fetchval(
            "SELECT output FROM semantic_population.document_extractions WHERE cache_key = $1", key)
        if value is None:
            return None
        value = json.loads(value) if isinstance(value, str) else dict(value)
        if EXTERNAL_KEY not in value:
            return value
        rows = await self.pool.fetch(
            "SELECT data FROM semantic_population.document_extraction_chunks "
            "WHERE cache_key = $1 ORDER BY ordinal", key)
        return await asyncio.to_thread(decode_output, value[EXTERNAL_KEY], [bytes(row["data"]) for row in rows])

    async def put(self, key: str, *, concept_id: str, asset_id: str, output: dict[str, Any]) -> None:
        encoded = await asyncio.to_thread(
            encode_output, output, inline_max_bytes=self.inline_max_bytes, chunk_bytes=self.chunk_bytes)
        body = json.dumps({EXTERNAL_KEY: encoded[0]} if encoded else output,
                          ensure_ascii=False, default=_canonical)
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                # Two workers reading the same sheet write the same key: one after the other.
                await connection.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key)
                await connection.execute(
                    "DELETE FROM semantic_population.document_extractions "
                    "WHERE model_id = $1 AND concept_id = $2 AND asset_id = $3 AND cache_key <> $4",
                    self.model_id, concept_id, asset_id, key)
                # A reading of this same key being replaced: its chunks go before the new ones come.
                await connection.execute(
                    "DELETE FROM semantic_population.document_extraction_chunks WHERE cache_key = $1", key)
                await connection.execute(
                    "INSERT INTO semantic_population.document_extractions "
                    "(cache_key, model_id, concept_id, asset_id, output) VALUES ($1, $2, $3, $4, $5::jsonb) "
                    "ON CONFLICT (cache_key) DO UPDATE SET output = EXCLUDED.output, created_at = now()",
                    key, self.model_id, concept_id, asset_id, body)
                if encoded:
                    await connection.executemany(
                        "INSERT INTO semantic_population.document_extraction_chunks (cache_key, ordinal, data) "
                        "VALUES ($1, $2, $3)",
                        [(key, ordinal, chunk) for ordinal, chunk in enumerate(encoded[1])])
