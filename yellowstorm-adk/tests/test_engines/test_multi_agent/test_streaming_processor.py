"""Unit tests for StreamingEventProcessor."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.smart_rag.engines.multi_agent.streaming_processor import StreamingEventProcessor
from src.smart_rag.messaging.formatters import StreamingFormatter


def _usage_event(text="hello", is_final=False):
  usage = SimpleNamespace(
    prompt_token_count=10,
    candidates_token_count=5,
    total_token_count=15,
  )
  part = SimpleNamespace(
    text=text,
    function_call=None,
    function_response=None,
  )
  content = SimpleNamespace(parts=[part])
  event = SimpleNamespace(
    content=content,
    usage_metadata=usage,
    model_version="gpt-test",
    is_final_response=MagicMock(return_value=is_final),
  )
  return event


class TestStreamingEventProcessor:
  @pytest.fixture
  def processor(self):
    config = SimpleNamespace(user_id="user-1", call_id_registry={})
    formatter = StreamingFormatter()
    repo = MagicMock()
    repo.get_all_agents.return_value = [
      {"id": "mgr-1", "name": "Team Manager", "agent_type": "manager"}
    ]
    return StreamingEventProcessor(config, formatter, repo)

  def test_get_manager_info_from_repository(self, processor):
    manager_id, manager_name = processor._get_manager_info()
    assert manager_id == "mgr-1"
    assert manager_name == "Team Manager"

  def test_get_manager_info_falls_back_to_agent_object(self):
    config = SimpleNamespace(user_id="user-1")
    formatter = StreamingFormatter()
    manager_agent = SimpleNamespace(id="fallback-id", name="Fallback Manager")
    processor = StreamingEventProcessor(config, formatter, agent_repository=None)

    manager_id, manager_name = processor._get_manager_info(manager_agent)

    assert manager_id == "fallback-id"
    assert manager_name == "Fallback Manager"

  @pytest.mark.asyncio
  async def test_process_streaming_events_streams_text_and_usage(self, processor):
    queue = AsyncMock()
    events = [_usage_event("Hello "), _usage_event("world")]

    async def fake_stream():
      for event in events:
        yield event

    agent_runner = MagicMock()
    agent_runner.run_async.return_value = fake_stream()

    with patch(
      "src.smart_rag.engines.multi_agent.streaming_processor.types.Content"
    ) as mock_content, patch(
      "src.smart_rag.engines.multi_agent.streaming_processor.types.Part"
    ) as mock_part, patch(
      "src.smart_rag.engines.multi_agent.streaming_processor.RunConfig"
    ):
      mock_content.return_value = MagicMock()
      mock_part.return_value = MagicMock()

      result = await processor.process_streaming_events(
        session_id="sess-1",
        user_prompt="Hi",
        manager_agent=SimpleNamespace(id="mgr-1", name="Team Manager"),
        agent_runner=agent_runner,
        q=queue,
      )

    assert result == "Hello world"
    assert queue.put.await_count >= 2
    usage_puts = [
      call.args[0]
      for call in queue.put.await_args_list
      if isinstance(call.args[0], dict) and "usage" in call.args[0]
    ]
    assert len(usage_puts) == 2
    assert usage_puts[0]["usage"]["input_tokens"] == 10

  @pytest.mark.asyncio
  async def test_process_streaming_events_with_image_input(self, processor):
    queue = AsyncMock()

    async def empty_stream():
      if False:
        yield None

    agent_runner = MagicMock()
    agent_runner.run_async.return_value = empty_stream()

    with patch(
      "src.smart_rag.engines.multi_agent.streaming_processor.build_content_with_images",
      return_value="image-content",
    ) as mock_build, patch(
      "src.smart_rag.engines.multi_agent.streaming_processor.RunConfig"
    ):
      result = await processor.process_streaming_events(
        session_id="sess-2",
        user_prompt="describe image",
        manager_agent=SimpleNamespace(id="mgr-1", name="Team Manager"),
        agent_runner=agent_runner,
        q=queue,
        image_input=[{"image 1": "abc"}],
      )

    mock_build.assert_called_once_with("describe image", [{"image 1": "abc"}])
    assert result == ""

  @pytest.mark.asyncio
  async def test_process_streaming_events_closes_stream(self, processor):
    closed = False

    class FakeStream:
      def __aiter__(self):
        return self

      async def __anext__(self):
        raise StopAsyncIteration

      async def aclose(self):
        nonlocal closed
        closed = True

    stream = FakeStream()
    agent_runner = MagicMock()
    agent_runner.run_async.return_value = stream

    with patch(
      "src.smart_rag.engines.multi_agent.streaming_processor.types.Content"
    ), patch(
      "src.smart_rag.engines.multi_agent.streaming_processor.types.Part"
    ), patch(
      "src.smart_rag.engines.multi_agent.streaming_processor.RunConfig"
    ):
      await processor.process_streaming_events(
        session_id="sess-3",
        user_prompt="Hi",
        manager_agent=SimpleNamespace(id="mgr-1", name="Team Manager"),
        agent_runner=agent_runner,
        q=None,
      )

    assert closed is True
