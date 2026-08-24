import base64

import pytest

from src.flow_engine.runtime.artifact_publication import (
    MAX_ARTIFACT_BYTES,
    decode_artifact_base64,
)


def test_decode_artifact_base64_accepts_bounded_content() -> None:
    assert decode_artifact_base64(base64.b64encode(b"pdf").decode("ascii")) == b"pdf"


@pytest.mark.parametrize("payload", ["", "not-base64!"])
def test_decode_artifact_base64_rejects_invalid_content(payload: str) -> None:
    with pytest.raises(ValueError):
        decode_artifact_base64(payload)


def test_decode_artifact_base64_rejects_oversized_content() -> None:
    payload = base64.b64encode(b"x" * (MAX_ARTIFACT_BYTES + 1)).decode("ascii")
    with pytest.raises(ValueError, match="10 MB"):
        decode_artifact_base64(payload)
