"""Additional coverage tests for streaming processor edge cases."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.smart_rag.engines.multi_agent.streaming_processor import StreamingEventProcessor
from src.smart_rag.messaging.component_tracker import ComponentTracker
from src.smart_rag.messaging.formatters import StreamingFormatter


def _processor():
    config = SimpleNamespace(user_id="user-1", call_id_registry={})
    return StreamingEventProcessor(config, StreamingFormatter(), MagicMock())


class TestStreamingProcessorEdgeCases:
    @pytest.mark.asyncio
    async def test_handle_plan_response_with_error(self):
        processor = _processor()
        queue = AsyncMock()
        response = SimpleNamespace(response={"result": '{"error": "bad plan"}'})
        await processor._handle_plan_response(
            response, "msg-1", queue, ComponentTracker("sess-1")
        )
        queue.put.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_handle_render_chart_response_empty(self):
        processor = _processor()
        queue = AsyncMock()
        response = SimpleNamespace(id="c1", response=None)
        await processor._handle_render_chart_response(response, "msg-1", queue)
        queue.put.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_handle_render_chart_response_with_error_field(self):
        processor = _processor()
        queue = AsyncMock()
        response = SimpleNamespace(id="c1", response={"error": True, "details": "bad data"})
        await processor._handle_render_chart_response(response, "msg-1", queue)
        queue.put.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_process_streaming_events_closes_stream(self):
        processor = _processor()
        queue = AsyncMock()

        class Stream:
            def __init__(self):
                self.closed = False

            def __aiter__(self):
                return self

            async def __anext__(self):
                raise StopAsyncIteration

            async def aclose(self):
                self.closed = True

        stream = Stream()
        agent_runner = MagicMock()
        agent_runner.run_async.return_value = stream

        with patch(
            "src.smart_rag.engines.multi_agent.streaming_processor.RunConfig"
        ), patch(
            "src.smart_rag.engines.multi_agent.streaming_processor.types.Content"
        ), patch(
            "src.smart_rag.engines.multi_agent.streaming_processor.types.Part"
        ):
            result = await processor.process_streaming_events(
                session_id="sess-1",
                user_prompt="hello",
                manager_agent=SimpleNamespace(id="m1", name="manager"),
                agent_runner=agent_runner,
                q=queue,
            )
        assert result == ""
        assert stream.closed is True

    @pytest.mark.asyncio
    async def test_handle_event_parts_skips_empty_content(self):
        processor = _processor()
        event = SimpleNamespace(content=None, usage_metadata=None)
        result = await processor._handle_event_parts(
            event, None, "msg-1", AsyncMock(), component_tracker=ComponentTracker("s1")
        )
        assert result[1] == 0
