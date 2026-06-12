"""Tests for callback helper functions."""

import pytest
import base64
from unittest.mock import MagicMock, patch, AsyncMock

from src.smart_rag.infrastructure.processing.callback_helper import (
    get_structured_context,
    inject_images_before_model,
)


class TestCallbackHelper:
    """Test cases for callback helper functions."""


    def test_get_structured_context_empty_events(self):
        """Test get_structured_context with empty events."""
        result = get_structured_context([])
        assert isinstance(result, str)

    def test_get_structured_context_with_search_agent_flag(self):
        """Test get_structured_context with search_agent flag."""
        result = get_structured_context([], search_agent=True)
        assert isinstance(result, str)

    def test_get_structured_context_with_events(self):
        """Test get_structured_context with mock events."""
        mock_event = MagicMock()
        mock_event.content = MagicMock()
        mock_event.content.parts = []

        result = get_structured_context([mock_event])
        assert isinstance(result, str)
        assert "<additional_context>" in result

    def test_get_structured_context_with_function_response(self):
        """Test get_structured_context with function response events."""
        mock_event = MagicMock()
        mock_event.content = MagicMock()

        mock_part = MagicMock()
        mock_part.function_response = MagicMock()
        mock_part.function_response.name = "delegate_to_search_agent"
        mock_part.function_response.response = {"result": "Test response"}

        mock_event.content.parts = [mock_part]

        result = get_structured_context([mock_event])

        assert isinstance(result, str)
        assert "<additional_context>" in result
        assert "search_agent" in result

    def test_get_structured_context_search_agent_filtering(self):
        """Test get_structured_context filters content for search agents."""
        mock_event = MagicMock()
        mock_event.content = MagicMock()

        mock_part = MagicMock()
        mock_part.function_response = MagicMock()
        mock_part.function_response.name = "delegate_to_search_agent"
        mock_part.function_response.response = {"result": "§task_1§image test content§"}

        mock_event.content.parts = [mock_part]

        result = get_structured_context([mock_event], search_agent=True)

        assert isinstance(result, str)
        # Should have filtered out the task markers
        assert "§task_1§image" not in result

    def test_base64_image_extraction_pattern(self):
        """Test base64 image pattern matching."""
        import re

        text_with_image = "Here is an image: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="

        pattern = r'data:image/([^;]+);base64,([A-Za-z0-9+/=]+)'
        matches = re.findall(pattern, text_with_image)

        assert len(matches) == 1
        assert matches[0][0] == "png"
        assert len(matches[0][1]) > 0

    def test_inject_images_before_model_appends_buffered_images(self):
        """Test buffered connector images are injected into the next LLM request."""
        image_base64 = base64.b64encode(b"\x89PNG\r\n\x1a\nfake").decode("ascii")

        state = {
            "_pending_tool_images_response-1": [
                {"mime": "image/png", "data": image_base64}
            ],
            "_list_of_filenames_response-1": ["img-1"],
        }
        callback_context = MagicMock()
        callback_context.state.to_dict.return_value = dict(state)
        callback_context.state.get.side_effect = lambda key, default=None: state.get(
            key, default
        )
        callback_context.state.__setitem__.side_effect = state.__setitem__
        llm_request = MagicMock()
        llm_request.contents = []

        inject_images_before_model(callback_context, llm_request)

        assert len(llm_request.contents) == 1
        assert "Inspect this image visually" in llm_request.contents[0].parts[0].text
        assert llm_request.contents[0].parts[1].inline_data.mime_type == "image/png"
        assert llm_request.contents[0].parts[1].inline_data.data == b"\x89PNG\r\n\x1a\nfake"
        assert state["_pending_tool_images_response-1"] == []

    def test_get_structured_context_multiple_events(self):
        """Test get_structured_context with multiple events."""
        events = []

        for i in range(3):
            mock_event = MagicMock()
            mock_event.content = MagicMock()

            mock_part = MagicMock()
            mock_part.function_response = MagicMock()
            mock_part.function_response.name = f"delegate_to_agent_{i}"
            mock_part.function_response.response = {"result": f"Response {i}"}

            mock_event.content.parts = [mock_part]
            events.append(mock_event)

        result = get_structured_context(events)

        assert isinstance(result, str)
        assert "<additional_context>" in result
