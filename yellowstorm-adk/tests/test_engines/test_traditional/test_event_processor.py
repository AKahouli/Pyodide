"""Unit tests for EventExtractor."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from src.smart_rag.engines.traditional.event_processor import EventExtractor


def _event_with_text(text: str, author: str = "agent-1"):
    part = SimpleNamespace(text=text, function_call=None, function_response=None)
    content = SimpleNamespace(parts=[part])
    event = SimpleNamespace(author=author, content=content)
    event.is_final_response = lambda: False
    return event


class TestEventExtractor:
    def test_extract_text_content_from_parts(self):
        event = _event_with_text("hello world")
        assert EventExtractor.extract_text_content(event) == "hello world"

    def test_extract_text_content_empty_when_no_parts(self):
        event = SimpleNamespace(author="a", content=None)
        assert EventExtractor.extract_text_content(event) == ""

    def test_has_function_call_true(self):
        part = SimpleNamespace(function_call=MagicMock(), function_response=None, text=None)
        event = SimpleNamespace(content=SimpleNamespace(parts=[part]))
        assert EventExtractor.has_function_call(event) is True

    def test_has_function_response_true(self):
        part = SimpleNamespace(function_call=None, function_response=MagicMock(), text=None)
        event = SimpleNamespace(content=SimpleNamespace(parts=[part]))
        assert EventExtractor.has_function_response(event) is True

    def test_extract_function_call_info_with_explicit_part(self):
        function_call = SimpleNamespace(name="search", args={"q": "test"})
        part = SimpleNamespace(function_call=function_call)
        event = SimpleNamespace(author="searcher", content=None)
        info = EventExtractor.extract_function_call_info(event, part=part)
        assert "search" in info
        assert "searcher" in info

    def test_extract_function_response_info(self):
        response = SimpleNamespace(response={"ok": True})
        part = SimpleNamespace(function_response=response)
        event = SimpleNamespace(author="worker", content=SimpleNamespace(parts=[part]))
        info = EventExtractor.extract_function_response_info(event)
        assert "worker" in info
        assert "function response" in info.lower()

    def test_extract_function_name_and_args(self):
        part = SimpleNamespace(function_call=SimpleNamespace(name="calc", args={"x": 1}))
        assert EventExtractor.extract_function_name(part) == "calc"
        assert EventExtractor.extract_function_args(part) == {"x": 1}

    def test_extract_error_info_from_function_response(self):
        part = SimpleNamespace(
            function_response=SimpleNamespace(is_error=True, response="boom"),
        )
        event = SimpleNamespace(content=SimpleNamespace(parts=[part]), error=None)
        assert EventExtractor.extract_error_info(event) == "boom"

    def test_extract_comprehensive_event_info(self):
        event = _event_with_text("answer")
        event.is_final_response = lambda: True
        info = EventExtractor.extract_comprehensive_event_info(event)
        assert info["agent_name"] == "agent-1"
        assert info["text_content"] == "answer"
        assert info["is_final"] is True
        assert info["has_function_call"] is False

    def test_extract_agent_name_fallback(self):
        event = SimpleNamespace()
        assert EventExtractor.extract_agent_name(event) == "Unknown Agent"
