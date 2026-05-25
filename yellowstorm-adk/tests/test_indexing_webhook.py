import pytest

from src.flow_engine.runtime.indexing_webhook import (
    pop_indexing_future,
    register_indexing_future,
    resolve_indexing_webhook,
)


@pytest.mark.asyncio
async def test_indexing_webhook_registry_resolves_registered_future() -> None:
    future = register_indexing_future("doc-1")

    resolved = resolve_indexing_webhook("doc-1", "FINISH", {"external_id": "doc-1"})

    assert resolved is True
    assert await future == {"status": "FINISH", "payload": {"external_id": "doc-1"}}
    assert pop_indexing_future("doc-1") is None
