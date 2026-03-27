"""Tests for message formatters."""

import pytest
import json
from unittest.mock import MagicMock

from src.smart_rag.messaging.formatters import StreamingFormatter


class TestStreamingFormatter:
    """Test cases for StreamingFormatter class."""

    def setup_method(self):
        """Create a StreamingFormatter instance for each test."""
        self.formatter = StreamingFormatter()

    def test_format_streaming_event_basic(self):
        """Test basic streaming event formatting."""
        result = self.formatter.format_streaming_event(
            agent_name="TestAgent",
            agent_type="search",
            chunk="Hello world",
            message_id="msg_123"
        )

        assert isinstance(result, dict)
        assert result["agent_name"] == "Test Agent"  # agent_name_stream adds space before "Agent"
        assert result["agent_type"] == "search"
        assert result["chunk"] == "Hello world"
        assert result["message_id"] == "msg_123"
        assert result["message_type"] == "streaming"
        assert result["content_type"] == "chunk"
        assert result["agent_id"] == "no_id"

    def test_format_streaming_event_with_custom_values(self):
        """Test streaming event formatting with custom values."""
        result = self.formatter.format_streaming_event(
            agent_name="CustomAgent",
            agent_type="report_writer",
            chunk="Custom content here",
            message_id="custom_123",
            content_type="final_response",
            agent_id="agent_456"
        )

        assert result["agent_name"] == "Custom Agent"  # agent_name_stream adds space before "Agent"
        assert result["agent_type"] == "report_writer"
        assert result["chunk"] == "Custom content here"
        assert result["message_id"] == "custom_123"
        assert result["content_type"] == "final_response"
        assert result["agent_id"] == "agent_456"

    def test_format_streaming_event_empty_chunk(self):
        """Test streaming event formatting with empty chunk."""
        result = self.formatter.format_streaming_event(
            agent_name="TestAgent",
            agent_type="operator",
            chunk="",
            message_id="msg_empty"
        )

        assert result["chunk"] == ""
        assert result["agent_name"] == "Test Agent"  # agent_name_stream adds space before "Agent"

    def test_format_task_description_event(self):
        """Test task description event formatting."""
        result = StreamingFormatter.format_task_description_event(
            agent_name="TaskAgent",
            agent_type="search",
            task_description="Search for relevant documents",
            message_id="task_123"
        )

        assert isinstance(result, dict)
        assert result["agent_name"] == "Task Agent"  # agent_name_stream is called twice: once in method, once in format_streaming_event
        assert result["agent_type"] == "search"
        assert result["chunk"] == "Search for relevant documents"
        assert result["message_id"] == "task_123"
        assert result["content_type"] == "description"
        assert result["message_type"] == "streaming"
        assert result["agent_id"] == "no_id"

    def test_format_task_description_event_with_agent_id(self):
        """Test task description event formatting with agent ID."""
        result = StreamingFormatter.format_task_description_event(
            agent_name="TaskAgent",
            agent_type="report_writer",
            task_description="Generate comprehensive report",
            message_id="task_456",
            agent_id="agent_789"
        )

        assert result["agent_id"] == "agent_789"
        assert result["chunk"] == "Generate comprehensive report"
        assert result["content_type"] == "description"

    def test_all_required_fields_present(self):
        """Test that all required fields are present in formatted events."""
        # Test streaming event
        streaming_result = self.formatter.format_streaming_event(
            agent_name="TestAgent",
            agent_type="test",
            chunk="test chunk",
            message_id="test_123"
        )

        required_fields = ["agent_id", "agent_name", "agent_type", "chunk", "message_id", "message_type", "content_type"]
        for field in required_fields:
            assert field in streaming_result

        # Test task description event
        task_result = StreamingFormatter.format_task_description_event(
            agent_name="TaskAgent",
            agent_type="task",
            task_description="test task",
            message_id="task_123"
        )

        for field in required_fields:
            assert field in task_result

    def test_different_agent_types(self):
        """Test formatting with different agent types."""
        agent_types = ["search", "report_writer", "operator", "html", "visualization"]

        for agent_type in agent_types:
            result = self.formatter.format_streaming_event(
                agent_name=f"{agent_type}_agent",
                agent_type=agent_type,
                chunk=f"Content from {agent_type}",
                message_id=f"msg_{agent_type}"
            )

            assert result["agent_type"] == agent_type

            base_name = " ".join(word.capitalize() for word in agent_type.split("_"))
            expected_name = f"{base_name} Agent"

            assert result["agent_name"] == expected_name

    def test_different_content_types(self):
        """Test formatting with different content types."""
        content_types = ["chunk", "description", "final_response", "error", "status"]

        for content_type in content_types:
            result = self.formatter.format_streaming_event(
                agent_name="TestAgent",
                agent_type="test",
                chunk="test content",
                message_id="test_msg",
                content_type=content_type
            )

            assert result["content_type"] == content_type

    def test_special_characters_in_chunks(self):
        """Test formatting with special characters in chunks."""
        special_chunks = [
            "Hello\nworld\n",
            "Content with \"quotes\" and 'apostrophes'",
            "Unicode: 🚀 ❤️ 🎉",
            "HTML-like: <div>content</div>",
            "JSON-like: {\"key\": \"value\"}",
            "URL: https://example.com/path?param=value"
        ]

        for chunk in special_chunks:
            result = self.formatter.format_streaming_event(
                agent_name="SpecialAgent",
                agent_type="test",
                chunk=chunk,
                message_id="special_msg"
            )

            assert result["chunk"] == chunk

    def test_json_serializable_output(self):
        """Test that formatted events are JSON serializable."""
        # Test with various inputs
        inputs = [
            {
                "agent_name": "JSONAgent",
                "agent_type": "test",
                "chunk": "Simple text",
                "message_id": "json_test"
            },
            {
                "agent_name": "ComplexAgent",
                "agent_type": "complex",
                "chunk": "Complex content with\nnewlines and \"quotes\"",
                "message_id": "complex_json",
                "content_type": "final_response",
                "agent_id": "agent_123"
            }
        ]

        for input_data in inputs:
            result = self.formatter.format_streaming_event(**input_data)

            # Should be JSON serializable
            json_str = json.dumps(result)
            assert isinstance(json_str, str)

            # Should be deserializable back to the same structure
            deserialized = json.loads(json_str)
            assert deserialized == result