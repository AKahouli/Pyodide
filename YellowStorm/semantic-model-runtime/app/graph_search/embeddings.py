"""Text embeddings through the platform's OpenAI-compatible LiteLLM proxy.

One pinned profile per deployment. Its fingerprint names everything that
decides where a vector lands (model, dimension, instructions, the search text
format), so vectors from different profiles are never compared. Every response
is checked: one finite, non-zero vector of the configured size per input, in
input order. Failures raise; nothing is silently skipped.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from dataclasses import dataclass
from typing import Any

import httpx

from .documents import FIELD_POLICY_VERSION, SERIALIZER_VERSION

# The column type in migration 022; another size needs its own storage.
STORAGE_DIMENSION = 2560
# Qwen3-Embedding is trained with an instruction on the query side only.
QUERY_INSTRUCTION = ("Instruct: Given a search request, retrieve the business records "
                     "that match it\nQuery: ")
DOCUMENT_PREFIX = ""


class EmbeddingError(RuntimeError):
    """``retryable`` errors (timeouts, 429, 5xx) may succeed later; the others will not."""

    def __init__(self, code: str, retryable: bool = False):
        super().__init__(code)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class EmbeddingProfile:
    base_url: str
    api_key: str
    model: str
    dimension: int
    timeout_seconds: float = 30.0
    batch_size: int = 32

    @property
    def fingerprint(self) -> str:
        body = json.dumps({"provider": "litellm", "model": self.model, "dimension": self.dimension,
                           "distance": "cosine", "documentPrefix": DOCUMENT_PREFIX,
                           "queryInstruction": QUERY_INSTRUCTION, "serializer": SERIALIZER_VERSION,
                           "fieldPolicy": FIELD_POLICY_VERSION}, sort_keys=True)
        return "emb:" + hashlib.sha256(body.encode("utf-8")).hexdigest()[:32]


def profile_from_env() -> EmbeddingProfile | None:
    """The configured profile, or None when embeddings are not set up here."""
    base_url = os.environ.get("SEMANTIC_EMBEDDING_BASE_URL", "").strip().rstrip("/")
    model = os.environ.get("SEMANTIC_EMBEDDING_MODEL", "").strip()
    if not base_url or not model:
        return None
    return EmbeddingProfile(
        base_url=base_url,
        api_key=os.environ.get("SEMANTIC_EMBEDDING_API_KEY", ""),
        model=model,
        dimension=int(os.environ.get("SEMANTIC_EMBEDDING_DIMENSION", str(STORAGE_DIMENSION))),
        timeout_seconds=float(os.environ.get("SEMANTIC_EMBEDDING_TIMEOUT_SECONDS", "30")),
        batch_size=max(1, min(128, int(os.environ.get("SEMANTIC_EMBEDDING_BATCH_SIZE", "32")))),
    )


def vector_literal(vector: list[float]) -> str:
    """pgvector text form; bound as text and cast in SQL (no client codec needed)."""
    return "[" + ",".join(format(value, ".7g") for value in vector) + "]"


async def embed(profile: EmbeddingProfile, texts: list[str], *, query: bool = False,
                client: httpx.AsyncClient | None = None) -> list[list[float]]:
    """Unit vectors for ``texts``, in order."""
    if profile.dimension != STORAGE_DIMENSION:
        raise EmbeddingError("embedding_dimension_unsupported")
    if not texts:
        return []
    prefix = QUERY_INSTRUCTION if query else DOCUMENT_PREFIX
    body = {"model": profile.model, "input": [prefix + text for text in texts],
            "encoding_format": "float"}
    headers = {"Authorization": f"Bearer {profile.api_key}"} if profile.api_key else {}
    owned = client is None
    client = client or httpx.AsyncClient(timeout=profile.timeout_seconds)
    try:
        response = await client.post(f"{profile.base_url}/v1/embeddings", json=body, headers=headers)
    except httpx.TimeoutException as exc:
        raise EmbeddingError("embedding_timeout", retryable=True) from exc
    except httpx.HTTPError as exc:
        raise EmbeddingError("embedding_unreachable", retryable=True) from exc
    finally:
        if owned:
            await client.aclose()
    if response.status_code == 429 or response.status_code >= 500:
        raise EmbeddingError(f"embedding_http_{response.status_code}", retryable=True)
    if response.status_code != 200:
        raise EmbeddingError(f"embedding_http_{response.status_code}")
    try:
        data = response.json()["data"]
        ordered = sorted(data, key=lambda item: item["index"])
        vectors = [item["embedding"] for item in ordered]
    except (ValueError, KeyError, TypeError) as exc:
        raise EmbeddingError("embedding_malformed_response") from exc
    if len(vectors) != len(texts) or [item["index"] for item in ordered] != list(range(len(texts))):
        raise EmbeddingError("embedding_count_mismatch")
    return [_unit(vector, profile.dimension) for vector in vectors]


def _unit(vector: Any, dimension: int) -> list[float]:
    if not isinstance(vector, list) or len(vector) != dimension:
        raise EmbeddingError("embedding_dimension_mismatch")
    try:
        values = [float(value) for value in vector]
    except (TypeError, ValueError) as exc:
        raise EmbeddingError("embedding_malformed_response") from exc
    if not all(math.isfinite(value) for value in values):
        raise EmbeddingError("embedding_not_finite")
    norm = math.sqrt(sum(value * value for value in values))
    if norm == 0:
        raise EmbeddingError("embedding_zero_vector")
    return [value / norm for value in values]
