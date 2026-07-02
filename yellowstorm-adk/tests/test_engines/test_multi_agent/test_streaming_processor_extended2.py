"""Extended streaming processor coverage for manager info and event loop."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from google.genai import types

from src.smart_rag.engines.multi_agent.streaming_processor import StreamingEventProcessor
from src.smart_rag.messaging.formatters import StreamingFormatter


def _text_event(text: str):
    part = SimpleNamespace(text=text, function_call=None, function_response=None)
    content = SimpleNamespace(parts=[part])
    usage = SimpleNamespace(
        prompt_token_count=10,
        candidates_token_count=5,
        total_token_count=15,
    )
    return SimpleNamespace(
        content=content,
        usage_metadata=usage,
        model_version="gpt-4o",
        is_final_response=MagicMock(return_value=False),
    )


@pytest.fixture
def processor():
    config = SimpleNamespace(user_id="user-1", call_id_registry={})
    repo = MagicMock()
    repo.get_all_agents.return_value = [
        {"id": "mgr-1", "name": "team_manager", "agent_type": "manager"}
    ]
    return StreamingEventProcessor(config, StreamingFormatter(), repo)


class TestStreamingProcessorExtended2:
    def test_get_manager_info_from_repository(self, processor):
        manager_id, manager_name = processor._get_manager_info()
        assert manager_id == "mgr-1"
        assert manager_name == "team_manager"

    def test_get_manager_info_falls_back_to_agent_object(self, processor):
        processor.agent_repository = None
        manager = SimpleNamespace(id="fallback-id", name="fallback_manager")
        manager_id, manager_name = processor._get_manager_info(manager)
        assert manager_id == "fallback-id"
        assert manager_name == "fallback_manager"

    @pytest.mark.asyncio
    async def test_handle_final_response_no_queue_put(self, processor):
        queue = AsyncMock()
        await processor._handle_final_response("msg-1", queue)
        queue.put.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_process_streaming_events_accumulates_text(self, processor):
        queue = AsyncMock()
        manager_agent = SimpleNamespace(id="mgr-1", name="manager")

        async def _stream():
            yield _text_event("Hello ")
            yield _text_event("team")

        agent_runner = MagicMock()
        agent_runner.run_async.return_value = _stream()

        with patch(
            "src.smart_rag.engines.multi_agent.streaming_processor.build_content_with_images",
            return_value=types.Content(role="user", parts=[types.Part(text="task")]),
        ):
            result = await processor.process_streaming_events(
                session_id="sess-1",
                user_prompt="task",
                manager_agent=manager_agent,
                agent_runner=agent_runner,
                q=queue,
            )
        assert "Hello" in result
        assert queue.put.await_count >= 2

    @pytest.mark.asyncio
    async def test_process_streaming_events_with_image_input(self, processor):
        queue = AsyncMock()
        manager_agent = SimpleNamespace(id="mgr-1", name="manager")

        async def _stream():
            if False:
                yield _text_event("never")

        agent_runner = MagicMock()
        agent_runner.run_async.return_value = _stream()

        with patch(
            "src.smart_rag.engines.multi_agent.streaming_processor.build_content_with_images"
        ) as mock_build:
            mock_build.return_value = types.Content(role="user", parts=[])
            await processor.process_streaming_events(
                session_id="sess-1",
                user_prompt="describe image",
                manager_agent=manager_agent,
                agent_runner=agent_runner,
                q=queue,
                image_input=[{"img": "data:image/png;base64,abc"}],
            )
        mock_build.assert_called_once()
