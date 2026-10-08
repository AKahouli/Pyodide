"""Search index progress: what a build records per batch and what the status endpoint shows."""

from __future__ import annotations

from typing import Any

import pytest

from app.graph_search import indexer
from app.graph_search.embeddings import EmbeddingProfile
from app.graph_search.settings import IndexSettings, index_fingerprint
from app.persistence import graph_search_store as search_store

PROFILE = EmbeddingProfile(base_url="http://embed.test", api_key="k", model="m", dimension=4, batch_size=2)
FINGERPRINT = index_fingerprint(PROFILE.fingerprint, IndexSettings())


def _row(**changes: Any) -> dict[str, Any]:
    row = {"index_id": "ix-1", "state": "indexing", "embedding_fingerprint": "emb:x", "expected_count": 8400,
           "indexed_count": 1200, "exact_only_count": 0, "failed_count": 0, "reused_count": 0,
           "embedding_calls": 3, "last_error_code": None, "passage_count": 0, "passage_indexed_count": 0,
           "passage_truncated_count": 0, "completed_at": None, "progress_stage": "embedding",
           "loaded_count": 8400}
    return {**row, **changes}


def test_status_shows_the_stage_and_counts_while_indexing() -> None:
    public = search_store.public_generation(_row())
    assert (public["stage"], public["loadedCount"]) == ("embedding", 8400)
    assert (public["indexedCount"], public["expectedCount"]) == (1200, 8400)


def test_status_has_no_stage_once_the_build_is_over() -> None:
    assert search_store.public_generation(_row(state="ready", progress_stage="embedding"))["stage"] is None
    assert search_store.public_generation(_row(state="queued", progress_stage="documents"))["stage"] is None


def test_status_of_a_row_built_before_the_progress_columns() -> None:
    legacy = {key: value for key, value in _row(state="ready").items() if key not in ("progress_stage", "loaded_count")}
    public = search_store.public_generation(legacy)
    assert (public["stage"], public["loadedCount"]) == (None, 0)


class _Store:
    """The generation row and tables of one build, in memory."""

    def __init__(self, documents: int, passages_per_document: int) -> None:
        self.documents = documents
        self.passages = documents * passages_per_document
        self.progress: list[dict[str, Any]] = []
        self.ready = 0
        self.passages_ready = 0
        self.finished_with: int | None = None

    async def get_generation_by_id(self, pool: Any, index_id: str) -> dict[str, Any]:
        return {"index_id": index_id, "state": "queued", "model_id": "m", "data_revision_id": "dr-1",
                "embedding_fingerprint": FINGERPRINT, "index_settings": None}

    async def claim_generation(self, *args: Any) -> bool:
        return True

    async def renew_generation(self, *args: Any) -> bool:
        return True

    async def linked_names(self, *args: Any) -> dict[str, Any]:
        return {}

    async def insert_documents(self, *args: Any) -> None:
        return None

    async def insert_passages(self, pool: Any, index_id: str, documents: list[dict[str, Any]]) -> int:
        return sum(len(document["passages"]) for document in documents)

    async def fill_from_cache(self, *args: Any, **kwargs: Any) -> int:
        return 0

    async def generation_counts(self, *args: Any) -> dict[str, int]:
        return {"total": self.documents, "ready": self.ready, "exact_only": 0, "pending": self.documents - self.ready,
                "truncated": 0, "passages": self.passages, "passages_ready": self.passages_ready}

    async def pending_documents(self, pool: Any, index_id: str, limit: int) -> list[dict[str, Any]]:
        count = min(limit, self.documents - self.ready)
        return [{"entity_id": f"e{n}", "search_text": "t", "content_hash": "h"} for n in range(count)]

    async def pending_passages(self, pool: Any, index_id: str, limit: int) -> list[dict[str, Any]]:
        count = min(limit, self.passages - self.passages_ready)
        return [{"entity_id": "e0", "ordinal": n, "search_text": "t", "content_hash": "h"} for n in range(count)]

    async def store_vectors(self, pool: Any, *, vectors: list[Any], **kwargs: Any) -> None:
        self.ready += len(vectors)

    async def store_passage_vectors(self, pool: Any, *, vectors: list[Any], **kwargs: Any) -> None:
        self.passages_ready += len(vectors)

    async def record_progress(self, pool: Any, index_id: str, owner: str, **fields: Any) -> None:
        self.progress.append(fields)

    async def finish_generation(self, pool: Any, index_id: str, owner: str, expected: int) -> str:
        self.finished_with = expected
        return "ready"

    async def prune_generations(self, *args: Any) -> int:
        return 0


@pytest.mark.asyncio
async def test_a_build_records_its_progress_batch_by_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    store = _Store(documents=5, passages_per_document=1)

    async def entities_pages(pool: Any, revision_id: str, size: int):  # type: ignore[no-untyped-def]
        for start in range(0, 5, 3):
            yield [{"entityId": f"e{n}", "conceptId": "c"} for n in range(start, min(start + 3, 5))]

    async def count_rows(pool: Any, revision_id: str) -> dict[str, int]:
        return {"entities": 5}

    async def specification(pool: Any, revision_id: str) -> dict[str, Any]:
        return {}

    async def embedder(profile: Any, texts: list[str]) -> list[list[float]]:
        return [[0.0] * 4 for _ in texts]

    for name in ("get_generation_by_id", "claim_generation", "renew_generation", "linked_names", "insert_documents",
                 "insert_passages", "fill_from_cache", "generation_counts", "pending_documents", "pending_passages",
                 "store_vectors", "store_passage_vectors", "record_progress", "finish_generation",
                 "prune_generations"):
        monkeypatch.setattr(indexer.search_store, name, getattr(store, name))
    monkeypatch.setattr(indexer.population_store, "iter_revision_entities", entities_pages)
    monkeypatch.setattr(indexer.population_store, "count_revision_rows", count_rows)
    monkeypatch.setattr(indexer.population_store, "get_revision_specification", specification)
    monkeypatch.setattr(indexer, "compile_specification", lambda spec: {"concepts": {}})
    monkeypatch.setattr(indexer, "build_document",
                        lambda entity, concept, settings, links=None: {"passages": [{"ordinal": 0}]})

    async def report(progress: dict[str, Any]) -> None:
        return None

    outcome = await indexer.build_index(object(), index_id="ix-1", owner="w", report=report,
                                        profile=PROFILE, embedder=embedder)

    assert outcome["state"] == "ready" and store.finished_with == 5
    documents = [p for p in store.progress if p["stage"] == "documents"]
    assert [(p["loaded"], p["expected"]) for p in documents] == [(0, 5), (3, 5), (5, 5)]
    assert documents[-1]["passages"] == 5
    embedding = [p for p in store.progress if p["stage"] == "embedding"]
    # Records in batches of 2, then the 5 passages in batches of 2; the first entry is the baseline.
    assert [p["indexed"] for p in embedding] == [0, 2, 4, 5, 5, 5, 5]
    assert [p["passages_indexed"] for p in embedding] == [0, 0, 0, 0, 2, 4, 5]
    assert all(p["expected"] == 5 and p["passages"] == 5 for p in embedding)
