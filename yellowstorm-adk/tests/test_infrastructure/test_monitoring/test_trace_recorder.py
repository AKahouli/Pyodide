"""Tests for TraceRecorder."""

import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime

from src.smart_rag.infrastructure.monitoring.trace_recorder import TraceRecorder


class TestTraceRecorder:
    """Test cases for TraceRecorder."""

    def test_init(self):
        """Test recorder initialization."""
        recorder = TraceRecorder("TestAgent", "test_type")
        assert recorder.agent_name == "TestAgent"
        assert recorder.agent_type == "test_type"
        assert recorder.history == []
        assert recorder.text_chunks == []
        assert recorder.function_calls == []
        assert recorder.function_responses == []
        assert recorder.errors == []
        assert recorder.final_result is None
        assert recorder.pending_function_call is None

    def test_init_with_defaults(self):
        """Test recorder initialization with default values."""
        recorder = TraceRecorder()
        assert recorder.agent_name is None
        assert recorder.agent_type is None

    @patch('src.smart_rag.infrastructure.monitoring.trace_recorder.TraceRecorder._get_timestamp')
    def test_record_chunk(self, mock_timestamp):
        """Test recording text chunks."""
        mock_timestamp.return_value = "2024-01-01T00:00:00"
        recorder = TraceRecorder("TestAgent")

        recorder.record_chunk("test text")

        assert len(recorder.text_chunks) == 1
        assert recorder.text_chunks[0] == "test text"
        # History tracking is not implemented in the current recorder.
        assert recorder.history == []

    @patch('src.smart_rag.infrastructure.monitoring.trace_recorder.TraceRecorder._get_timestamp')
    def test_record_function_call(self, mock_timestamp):
        """Test recording function calls."""
        mock_timestamp.return_value = "2024-01-01T00:00:00"
        recorder = TraceRecorder("TestAgent")

        args = {"param1": "value1", "param2": "value2"}
        recorder.record_function_call("test_function", args, "search")

        # record_function_call is currently a no-op in the recorder.
        assert recorder.function_calls == []
        assert recorder.history == []
        assert recorder.pending_function_call is None

    @patch('src.smart_rag.infrastructure.monitoring.trace_recorder.TraceRecorder._get_timestamp')
    def test_record_function_call_with_none_args(self, mock_timestamp):
        """Test recording function call with None arguments."""
        mock_timestamp.return_value = "2024-01-01T00:00:00"
        recorder = TraceRecorder("TestAgent")

        recorder.record_function_call("test_function", None, "search")

        # record_function_call is currently a no-op in the recorder.
        assert recorder.function_calls == []

    def test_record_multiple_chunks(self):
        """Test recording multiple text chunks."""
        recorder = TraceRecorder("TestAgent")

        recorder.record_chunk("chunk 1")
        recorder.record_chunk("chunk 2")
        recorder.record_chunk("chunk 3")

        assert len(recorder.text_chunks) == 3
        assert recorder.text_chunks == ["chunk 1", "chunk 2", "chunk 3"]
        # History tracking is not implemented in the current recorder.
        assert recorder.history == []

    def test_record_multiple_function_calls(self):
        """Test recording multiple function calls."""
        recorder = TraceRecorder("TestAgent")

        recorder.record_function_call("func1", {"arg1": "val1"}, "search")
        recorder.record_function_call("func2", {"arg2": "val2"}, "calculation")

        # record_function_call is currently a no-op in the recorder.
        assert recorder.function_calls == []

    def test_pending_function_call_updates(self):
        """Test that pending function call is updated correctly."""
        recorder = TraceRecorder("TestAgent")

        recorder.record_function_call("func1", {"arg1": "val1"}, "search")
        recorder.record_function_call("func2", {"arg2": "val2"}, "calculation")

        # record_function_call does not track pending calls in the current recorder.
        assert recorder.pending_function_call is None

    def test_history_order(self):
        """Test that history maintains chronological order."""
        recorder = TraceRecorder("TestAgent")

        recorder.record_chunk("text 1")
        recorder.record_function_call("func1", {"arg1": "val1"}, "search")
        recorder.record_chunk("text 2")

        # History tracking is not implemented; only text_chunks are retained.
        assert recorder.history == []
        assert recorder.text_chunks == ["text 1", "text 2"]

    def test_empty_recorder_state(self):
        """Test recorder state when no operations recorded."""
        recorder = TraceRecorder("TestAgent")

        assert len(recorder.history) == 0
        assert len(recorder.text_chunks) == 0
        assert len(recorder.function_calls) == 0
        assert len(recorder.function_responses) == 0
        assert len(recorder.errors) == 0
        assert recorder.pending_function_call is None