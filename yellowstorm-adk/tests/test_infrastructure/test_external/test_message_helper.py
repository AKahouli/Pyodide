"""Tests for MessageHelper."""

import json
from unittest.mock import AsyncMock, patch
import pytest

from src.smart_rag.infrastructure.external.message_helper import MessageHelper


class TestMessageHelper:
    """Test cases for MessageHelper."""

    def test_init(self):
        """Test message helper initialization."""
        helper = MessageHelper()
        assert helper is not None

    @pytest.mark.asyncio
    async def test_send_suggestions_success(self):
        """Test sending suggestions successfully."""
        mock_queue = AsyncMock()
        session_id = "session123"
        suggestions = [
            {"name": "SearchAgent", "type": "search", "description": "Search documents"},
            {"name": "ReportAgent", "type": "report", "description": "Generate reports"}
        ]

        await MessageHelper._send_suggestions(mock_queue, session_id, suggestions)

        # Verify the queue was called with the correct message
        mock_queue.put.assert_called_once()
        call_args = mock_queue.put.call_args[0][0]

        assert call_args["agent_name"] == "system"  # SYSTEM_AGENT_NAME
        assert call_args["agent_type"] == "suggestions"  # SUGGESTIONS_CONTENT_TYPE
        assert call_args["message_id"] == session_id
        assert call_args["message_type"] == "no-streaming"  # NO_STREAMING_MESSAGE_TYPE
        assert call_args["content_type"] == "suggestions"  # SUGGESTIONS_CONTENT_TYPE

        # Verify suggestions are JSON serialized
        assert json.loads(call_args["chunk"]) == suggestions

    @pytest.mark.asyncio
    async def test_send_suggestions_empty_list(self):
        """Test sending empty suggestions list."""
        mock_queue = AsyncMock()
        session_id = "session123"
        suggestions = []

        await MessageHelper._send_suggestions(mock_queue, session_id, suggestions)

        # Should still send the message even with empty suggestions
        mock_queue.put.assert_called_once()
        call_args = mock_queue.put.call_args[0][0]
        assert json.loads(call_args["chunk"]) == []

    @pytest.mark.asyncio
    async def test_send_suggestions_queue_error(self):
        """Test sending suggestions with queue error."""
        mock_queue = AsyncMock()
        mock_queue.put.side_effect = Exception("Queue error")
        session_id = "session123"
        suggestions = [{"name": "TestAgent", "type": "test"}]

        with patch('src.smart_rag.infrastructure.external.message_helper.logger') as mock_logger:
            await MessageHelper._send_suggestions(mock_queue, session_id, suggestions)

            # Should log the error
            mock_logger.error.assert_called_once()
            assert "Failed to send suggestions" in mock_logger.error.call_args[0][0]

    @pytest.mark.asyncio
    async def test_send_error_message_success(self):
        """Test sending error message successfully."""
        mock_queue = AsyncMock()
        session_id = "session123"
        error_msg = "An error occurred during processing"

        await MessageHelper._send_error_message(mock_queue, session_id, error_msg)

        # Should call put twice - once for the error component, once for None (end signal)
        assert mock_queue.put.call_count == 2

        # Check the error component structure
        first_call_args = mock_queue.put.call_args_list[0][0][0]
        assert first_call_args["action"] == "add"
        assert first_call_args["component"]["type"] == "error"
        assert first_call_args["component"]["data"]["title"] == "Error"
        assert first_call_args["component"]["data"]["content"] == error_msg
        assert first_call_args["metadata"]["message_id"] == session_id

        # Check the end signal
        second_call_args = mock_queue.put.call_args_list[1][0][0]
        assert second_call_args is None

    @pytest.mark.asyncio
    async def test_send_error_message_empty_error(self):
        """Test sending empty error message."""
        mock_queue = AsyncMock()
        session_id = "session123"
        error_msg = ""

        await MessageHelper._send_error_message(mock_queue, session_id, error_msg)

        # Should still send the message even with empty error
        assert mock_queue.put.call_count == 2
        first_call_args = mock_queue.put.call_args_list[0][0][0]
        assert first_call_args["component"]["data"]["content"] == ""

    @pytest.mark.asyncio
    async def test_send_error_message_queue_error(self):
        """Test sending error message with queue error."""
        mock_queue = AsyncMock()
        mock_queue.put.side_effect = Exception("Queue error")
        session_id = "session123"
        error_msg = "Original error"

        with patch('src.smart_rag.infrastructure.external.message_helper.logger') as mock_logger:
            await MessageHelper._send_error_message(mock_queue, session_id, error_msg)

            # Should log twice: once when starting, once when failing
            assert mock_logger.error.call_count == 2
            # Check that the failure is logged
            error_calls = [call[0][0] for call in mock_logger.error.call_args_list]
            assert any("Failed to send error message" in call for call in error_calls)

    @pytest.mark.asyncio
    async def test_send_suggestions_with_complex_data(self):
        """Test sending suggestions with complex data structures."""
        mock_queue = AsyncMock()
        session_id = "session123"
        suggestions = [
            {
                "name": "ComplexAgent",
                "type": "analysis",
                "description": "Complex analysis agent",
                "capabilities": ["analyze", "summarize"],
                "config": {
                    "max_tokens": 1000,
                    "temperature": 0.7
                }
            }
        ]

        await MessageHelper._send_suggestions(mock_queue, session_id, suggestions)

        # Verify complex data is properly serialized
        mock_queue.put.assert_called_once()
        call_args = mock_queue.put.call_args[0][0]

        # Should be able to round-trip the JSON
        deserialized = json.loads(call_args["chunk"])
        assert deserialized == suggestions
        assert deserialized[0]["config"]["max_tokens"] == 1000

    @pytest.mark.asyncio
    async def test_send_suggestions_json_serialization_error(self):
        """Test sending suggestions with non-serializable data."""
        mock_queue = AsyncMock()
        session_id = "session123"

        # Create a circular reference that can't be JSON serialized
        circular_ref = {}
        circular_ref["self"] = circular_ref
        suggestions = [{"data": circular_ref}]

        with patch('src.smart_rag.infrastructure.external.message_helper.logger') as mock_logger, \
             patch('json.dumps', side_effect=TypeError("Object of type dict is not JSON serializable")):

            await MessageHelper._send_suggestions(mock_queue, session_id, suggestions)

            # Should log the error due to JSON serialization failure
            mock_logger.error.assert_called_once()

    def test_message_helper_class_methods(self):
        """Test that MessageHelper has the expected static methods."""
        # Test that the methods exist and are static
        assert hasattr(MessageHelper, '_send_suggestions')
        assert hasattr(MessageHelper, '_send_error_message')

        # Test that they are static methods (can be called on class)
        import inspect
        assert inspect.isfunction(MessageHelper._send_suggestions)
        assert inspect.isfunction(MessageHelper._send_error_message)

    @pytest.mark.asyncio
    async def test_send_error_message_partial_queue_failure(self):
        """Test error message sending with partial queue failure."""
        mock_queue = AsyncMock()
        # First call succeeds, second call (None) fails
        mock_queue.put.side_effect = [None, Exception("Queue closed")]
        session_id = "session123"
        error_msg = "Test error"

        with patch('src.smart_rag.infrastructure.external.message_helper.logger') as mock_logger:
            await MessageHelper._send_error_message(mock_queue, session_id, error_msg)

            # Should log twice: once when starting, once when failing
            assert mock_logger.error.call_count == 2
            # Check that the failure is logged
            error_calls = [call[0][0] for call in mock_logger.error.call_args_list]
            assert any("Failed to send error message" in call for call in error_calls)
