"""Unit tests for smart_rag engine helper utilities."""

import base64
import json
from types import SimpleNamespace

import pytest

from src.smart_rag.engines.helpers import (
    build_content_with_images,
    coerce_to_dict,
    coerce_to_plain,
    decode_data_uri_to_part,
)


class TestEngineHelpers:
    def test_coerce_to_plain_nested(self):
        data = {"a": [1, {"b": 2}]}
        assert coerce_to_plain(data) == {"a": [1, {"b": 2}]}

    def test_coerce_to_dict_from_json_string(self):
        assert coerce_to_dict('{"x": 1}') == {"x": 1}

    def test_coerce_to_dict_invalid_json_returns_empty(self):
        assert coerce_to_dict("not-json") == {}

    def test_coerce_to_dict_from_mapping(self):
        mapping = SimpleNamespace()
        mapping.items = lambda: [("k", "v")]
        # SimpleNamespace is not Mapping; use dict-like
        assert coerce_to_dict({"k": "v"}) == {"k": "v"}

    def test_decode_data_uri_to_part(self):
        raw = base64.b64encode(b"img-bytes").decode()
        part = decode_data_uri_to_part(f"data:image/png;base64,{raw}")
        assert part.inline_data.mime_type == "image/png"

    def test_decode_raw_base64_to_part(self):
        raw = base64.b64encode(b"jpeg-bytes").decode()
        part = decode_data_uri_to_part(raw)
        assert part.inline_data.mime_type == "image/jpeg"

    def test_build_content_with_images(self):
        raw = base64.b64encode(b"x").decode()
        content = build_content_with_images(
            "describe",
            [{"image 1": f"data:image/jpeg;base64,{raw}"}],
        )
        assert content.parts[0].text == "describe"
        assert len(content.parts) == 2
