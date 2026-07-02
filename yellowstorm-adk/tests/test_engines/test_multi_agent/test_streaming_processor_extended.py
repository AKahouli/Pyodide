"""Extended unit tests for StreamingEventProcessor."""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.smart_rag.engines.multi_agent.streaming_processor import StreamingEventProcessor
from src.smart_rag.messaging.component_tracker import ComponentTracker
from src.smart_rag.messaging.formatters import StreamingFormatter


def _event_with_function_call(name, args=None, call_id="call-1"):
    function_call = SimpleNamespace(name=name, args=args or {}, id=call_id)
    part = SimpleNamespace(text=None, function_call=function_call, function_response=None)
    content = SimpleNamespace(parts=[part])
    return SimpleNamespace(
        content=content,
        usage_metadata=None,
        is_final_response=MagicMock(return_value=False),
    )


def _event_with_function_response(name, response, response_id="resp-1"):
    function_response = SimpleNamespace(name=name, response=response, id=response_id)
    part = SimpleNamespace(text=None, function_call=None, function_response=function_response)
    content = SimpleNamespace(parts=[part])
    return SimpleNamespace(
        content=content,
        usage_metadata=None,
        is_final_response=MagicMock(return_value=False),
    )


@pytest.fixture
def processor():
    config = SimpleNamespace(user_id="user-1", call_id_registry={})
    repo = MagicMock()
    repo.get_agent_by_name.return_value = {"id": "agent-1", "name": "search_agent"}
    repo.get_agent_id_by_name.return_value = "agent-1"
    formatter = StreamingFormatter()
    return StreamingEventProcessor(config, formatter, repo)


class TestStreamingProcessorFunctionCalls:
    @pytest.mark.asyncio
    async def test_handle_event_parts_delegate_function_call(self, processor):
        queue = AsyncMock()
        event = _event_with_function_call("delegate_to_search_agent", {"task": "find docs"})
        with patch(
            "src.smart_rag.engines.multi_agent.streaming_processor.langfuse_client"
        ) as mock_langfuse:
            mock_langfuse.event.return_value = MagicMock()
            _, delegation_count, _, current_agent = await processor._handle_event_parts(
                event,
                SimpleNamespace(id="mgr-1", name="manager"),
                "msg-1",
                queue,
                delegation_count=0,
                accumulated_manager_text="",
                current_agent="manager",
                component_tracker=ComponentTracker("sess-1"),
            )
        assert delegation_count == 1
        assert processor.config.call_id_registry["search_agent"]["call_id"] == "call-1"

    @pytest.mark.asyncio
    async def test_handle_event_parts_python_interpreter_call(self, processor):
        queue = AsyncMock()
        event = _event_with_function_call("python_interpreter", {"code": "print(1)"})
        with patch(
            "src.smart_rag.engines.multi_agent.streaming_processor.langfuse_client"
        ) as mock_lf:
            mock_lf.event.return_value = MagicMock()
            await processor._handle_event_parts(
                event,
                None,
                "msg-1",
                queue,
                component_tracker=ComponentTracker("sess-1"),
            )
        assert queue.put.await_count >= 1

    @pytest.mark.asyncio
    async def test_handle_event_parts_generate_ui_call(self, processor):
        queue = AsyncMock()
        event = _event_with_function_call("generate_ui")
        with patch(
            "src.smart_rag.engines.multi_agent.streaming_processor.langfuse_client"
        ) as mock_lf:
            mock_lf.event.return_value = MagicMock()
            await processor._handle_event_parts(event, None, "msg-1", queue)
        assert queue.put.await_count == 1


class TestStreamingProcessorResponses:
    @pytest.mark.asyncio
    async def test_handle_dataviz_response(self, processor):
        queue = AsyncMock()
        response = SimpleNamespace(response={"ui": {"title": "Chart"}})
        await processor._handle_dataviz_response(response, "msg-1", queue)
        queue.put.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handle_formviz_response(self, processor):
        queue = AsyncMock()
        model = MagicMock()
        model.model_dump.return_value = {"type": "resource"}
        response = SimpleNamespace(response={"content": [model]})
        await processor._handle_formviz_response(response, "msg-1", queue)
        queue.put.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handle_plan_response(self, processor):
        queue = AsyncMock()
        plan = {"title": "Plan", "steps": [{"task": "Search", "status": "pending"}]}
        response = SimpleNamespace(response={"result": json.dumps(plan)})
        tracker = ComponentTracker("sess-1")
        await processor._handle_plan_response(response, "msg-1", queue, tracker)
        assert queue.put.await_count >= 1

    @pytest.mark.asyncio
    async def test_handle_web_search_response_streams_sources(self, processor):
        queue = AsyncMock()
        response = SimpleNamespace(
            response={"text": "answer", "sources": [{"title": "Site", "url": "https://x"}]}
        )
        await processor._handle_web_search_response(response, "msg-1", queue)
        queue.put.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handle_python_interpreter_response(self, processor):
        queue = AsyncMock()
        response = SimpleNamespace(
            id="sandbox-1",
            response={"stdout": "42", "stderr": ""},
        )
        await processor._handle_python_interpreter_response(response, "msg-1", queue)
        queue.put.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handle_render_chart_response(self, processor):
        queue = AsyncMock()
        response = SimpleNamespace(
            id="chart-1",
            response={
                "title": "Revenue",
                "chartData": [{"x": 1, "y": 2}],
                "kind": "bar",
            },
        )
        await processor._handle_render_chart_response(response, "msg-1", queue)
        queue.put.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handle_text_event_finishes_component_after_delegation(self, processor):
        queue = AsyncMock()
        tracker = ComponentTracker("sess-1")
        processor.streaming_formatter.component_tracker = tracker
        agent = SimpleNamespace(id="mgr-1", name="manager")
        current = await processor._handle_text_event("hello", "msg-1", queue, agent, "search_agent")
        assert current == "manager"
        queue.put.assert_awaited_once()
