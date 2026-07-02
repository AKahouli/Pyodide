"""Unit tests for tool_utils normalization helpers."""

from src.smart_rag.tools.utilities.tool_utils import (
    extract_tool_names,
    extract_tool_names_and_descriptions,
    normalize_tools,
)


def _sample_fn():
    return "ok"


class TestToolUtils:
    def test_normalize_tools_handles_callable_and_unknown(self):
        normalized = normalize_tools(["Search", _sample_fn, 42])
        assert normalized[0] == "search"
        assert normalized[1] is _sample_fn
        assert normalized[2] == 42

    def test_extract_tool_names_handles_callable_and_unknown(self):
        names = extract_tool_names(["Search", _sample_fn, object()])
        assert names[0] == "search"
        assert names[1] == "_sample_fn"
        assert "object" in names[2]

    def test_extract_tool_names_and_descriptions_callable_and_unknown(self):
        text = extract_tool_names_and_descriptions([_sample_fn, 99])
        assert "_sample_fn: No description available" in text
        assert "99: No description available" in text
