import pytest
from pydantic import ValidationError

from src.infrastructure.files import FileHandoffService, ResolvedFile


def _file() -> ResolvedFile:
    return ResolvedFile(
        name="forecast.pdf",
        path="/workspace/sources/finance/forecast.pdf",
        source_kind="workspace",
        source_alias="finance",
        size_bytes=53_218_421,
        modified_at="2026-08-20T10:30:00Z",
        content_type="application/pdf",
    )


def test_resolved_file_serializes_only_safe_logical_metadata():
    serialized = _file().to_runtime()
    assert serialized["source"] == {"kind": "workspace", "alias": "finance"}
    assert "objectKey" not in serialized
    assert "cephPrefix" not in serialized
    with pytest.raises(ValidationError):
        ResolvedFile.model_validate({**_file().model_dump(), "object_key": "secret/path"})


@pytest.mark.asyncio
async def test_generic_handoff_uses_fake_consumers_without_storage_identifiers():
    received = []

    class Consumer:
        async def consume(self, file, *, context):
            received.append((file, context))
            return {"accepted": file.path}

    service = FileHandoffService()
    service.register("fake-heavy", Consumer())
    result = await service.handoff("fake-heavy", _file(), context={"runId": "run-1"})
    assert result == {"accepted": "/workspace/sources/finance/forecast.pdf"}
    assert received[0][0] == _file()
    assert received[0][1] == {"runId": "run-1"}
