"""Unit tests for StreamingEventProcessor."""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.smart_rag.engines.multi_agent.streaming_processor import StreamingEventProcessor
from src.smart_rag.messaging.formatters import StreamingFormatter


def _usage_event(text="hello", is_final=False, thought=False, function_call=None, partial=None):
  usage = SimpleNamespace(
    prompt_token_count=10,
    candidates_token_count=5,
    total_token_count=15,
  )
  part = SimpleNamespace(
    text=text,
    thought=thought,
    function_call=function_call,
    function_response=None,
  )
  content = SimpleNamespace(parts=[part])
  event = SimpleNamespace(
    content=content,
    usage_metadata=usage,
    model_version="gpt-test",
    partial=partial,
    is_final_response=MagicMock(return_value=is_final),
  )
  return event


def _function_call_event(narration, partial, narration_on_tool=False):
  function_call = SimpleNamespace(id="call-1", name="search", args={"q": "docs"})
  tool_part = SimpleNamespace(
    text=narration if narration_on_tool else None,
    thought=False,
    function_call=function_call,
    function_response=None,
  )
  content = SimpleNamespace(parts=[tool_part] if narration_on_tool else [
    SimpleNamespace(text=narration, thought=False, function_call=None, function_response=None),
    tool_part,
  ])
  return SimpleNamespace(
    content=content,
    usage_metadata=None,
    partial=partial,
    is_final_response=MagicMock(return_value=False),
  )


def _text_chunks(queue):
  return [
    call.args[0]["chunk"] for call in queue.put.await_args_list
    if isinstance(call.args[0], dict) and "chunk" in call.args[0]
  ]


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
  async def test_process_streaming_events_coalesces_thought_tokens_until_tool_boundary(self, processor):
    queue = AsyncMock()
    events = [
      _usage_event("The", thought=True, partial=True),
      _usage_event(" user", thought=True, partial=True),
      _usage_event(" just", thought=True, partial=True),
      _usage_event(" said", thought=True, partial=True),
      _usage_event("Visible answer", partial=True),
      _usage_event("The user just said", thought=True, partial=False),
      _usage_event(None, function_call=SimpleNamespace(id="call-1", name="search", args={"q": "docs"}), partial=False),
    ]

    async def fake_stream():
      for event in events:
        yield event

    agent_runner = MagicMock()
    agent_runner.run_async.return_value = fake_stream()
    with patch("src.smart_rag.engines.multi_agent.streaming_processor.types.Content"), patch(
      "src.smart_rag.engines.multi_agent.streaming_processor.types.Part"
    ), patch("src.smart_rag.engines.multi_agent.streaming_processor.RunConfig"):
      result = await processor.process_streaming_events(
        session_id="thoughts",
        user_prompt="Hi",
        manager_agent=SimpleNamespace(id="mgr-1", name="Team Manager"),
        agent_runner=agent_runner,
        q=queue,
      )

    activity_events = [
      call.args[0] for call in queue.put.await_args_list
      if isinstance(call.args[0], dict) and call.args[0].get("component", {}).get("type") == "agent_activity"
    ]
    first_span = activity_events[:4]
    assert result == ""
    assert [event["action"] for event in activity_events] == ["add", "update", "update", "update"]
    assert len({event["component"]["id"] for event in first_span}) == 1
    assert [event["component"]["data"]["detail"] for event in first_span] == [
      "The", "The user", "The user just", "The user just said",
    ]
    assert len({event["component"]["data"]["started_at"] for event in first_span}) == 1

  @pytest.mark.asyncio
  async def test_manager_result_excludes_text_before_tool_call(self, processor):
    queue = AsyncMock()
    events = [
      _usage_event("Before tool"),
      _usage_event(
        None,
        function_call=SimpleNamespace(id="call-1", name="search", args={"q": "docs"}),
      ),
      SimpleNamespace(
        content=SimpleNamespace(parts=[SimpleNamespace(
          text=None,
          thought=False,
          function_call=None,
          function_response=SimpleNamespace(
            id="call-1", name="search", response={"matches": 1}, is_error=False,
          ),
        )]),
        usage_metadata=None,
        is_final_response=MagicMock(return_value=False),
      ),
      _usage_event("After tool"),
      _usage_event("After tool", is_final=True),
    ]

    async def fake_stream():
      for event in events:
        yield event

    agent_runner = MagicMock()
    agent_runner.run_async.return_value = fake_stream()
    with patch("src.smart_rag.engines.multi_agent.streaming_processor.types.Content"), patch(
      "src.smart_rag.engines.multi_agent.streaming_processor.types.Part"
    ), patch("src.smart_rag.engines.multi_agent.streaming_processor.RunConfig"):
      result = await processor.process_streaming_events(
        session_id="tool-result",
        user_prompt="Hi",
        manager_agent=SimpleNamespace(id="mgr-1", name="Team Manager"),
        agent_runner=agent_runner,
        q=queue,
      )

    assert result == "After tool"

  @pytest.mark.asyncio
  @pytest.mark.parametrize(("partial", "narration", "narration_on_tool", "expected_narration"), [
    (True, "Inspect the selected document.", False, []),
    (False, "Inspect the selected document.", False, ["Inspect the selected document."]),
    (None, "Inspect the selected document.", False, ["Inspect the selected document."]),
    (False, "start", False, []),
    (False, "Inspect the selected document.", True, []),
  ])
  async def test_function_call_narration_requires_complete_event(
    self, processor, partial, narration, narration_on_tool, expected_narration,
  ):
    queue = AsyncMock()

    async def fake_stream():
      yield _function_call_event(narration, partial, narration_on_tool)

    agent_runner = MagicMock()
    agent_runner.run_async.return_value = fake_stream()
    with patch("src.smart_rag.engines.multi_agent.streaming_processor.types.Content"), patch(
      "src.smart_rag.engines.multi_agent.streaming_processor.types.Part"
    ), patch("src.smart_rag.engines.multi_agent.streaming_processor.RunConfig"):
      await processor.process_streaming_events(
        session_id="narration",
        user_prompt="Hi",
        manager_agent=SimpleNamespace(id="mgr-1", name="Team Manager"),
        agent_runner=agent_runner,
        q=queue,
      )

    component_events = [
      call.args[0] for call in queue.put.await_args_list
      if isinstance(call.args[0], dict) and "component" in call.args[0]
    ]
    activity_summaries = [
      event["component"]["data"]["summary"] for event in component_events
      if event["component"]["type"] == "agent_activity"
    ]
    tool_events = [
      event for event in component_events
      if event["component"]["type"] == "tool_activity"
    ]
    assert activity_summaries == expected_narration
    assert len(tool_events) == 1
    assert tool_events[0]["component"]["data"]["tool_name"] == "search"

  @pytest.mark.asyncio
  async def test_guarded_output_emits_only_validated_final_text(self, processor):
    queue = AsyncMock()
    events = [_usage_event("unsafe partial"), _usage_event("blocked replacement", is_final=True)]

    async def fake_stream():
      for event in events:
        yield event

    agent_runner = MagicMock()
    agent_runner.run_async.return_value = fake_stream()
    manager = SimpleNamespace(
      id="mgr-1", name="Team Manager", tools=[], sub_agents=[],
      _guardrails_output_enabled=True,
    )
    with patch("src.smart_rag.engines.multi_agent.streaming_processor.types.Content"), patch(
      "src.smart_rag.engines.multi_agent.streaming_processor.types.Part"
    ), patch("src.smart_rag.engines.multi_agent.streaming_processor.RunConfig"):
      result = await processor.process_streaming_events(
        session_id="guarded", user_prompt="Hi", manager_agent=manager,
        agent_runner=agent_runner, q=queue,
      )

    payload_history = json.dumps([call.args[0] for call in queue.put.await_args_list], default=str)
    assert result == "blocked replacement"
    assert "unsafe partial" not in payload_history
    assert "blocked replacement" in payload_history

  @pytest.mark.asyncio
  async def test_guarded_output_discards_partial_text_when_stream_ends_without_final(self, processor):
    queue = AsyncMock()

    async def fake_stream():
      yield _usage_event("unsafe partial")

    agent_runner = MagicMock()
    agent_runner.run_async.return_value = fake_stream()
    manager = SimpleNamespace(
      id="mgr-1", name="Team Manager", tools=[], sub_agents=[],
      _guardrails_output_enabled=True,
    )
    with patch("src.smart_rag.engines.multi_agent.streaming_processor.types.Content"), patch(
      "src.smart_rag.engines.multi_agent.streaming_processor.types.Part"
    ), patch("src.smart_rag.engines.multi_agent.streaming_processor.RunConfig"):
      result = await processor.process_streaming_events(
        session_id="guarded-disconnect", user_prompt="Hi", manager_agent=manager,
        agent_runner=agent_runner, q=queue,
      )

    payload_history = json.dumps([call.args[0] for call in queue.put.await_args_list], default=str)
    assert result == ""
    assert "unsafe partial" not in payload_history

  @pytest.mark.asyncio
  async def test_unguarded_output_emits_terminal_only_final_text(self, processor):
    queue = AsyncMock()
    events = [_usage_event("Visible answer", is_final=True)]

    async def fake_stream():
      for event in events:
        yield event

    agent_runner = MagicMock()
    agent_runner.run_async.return_value = fake_stream()
    with patch("src.smart_rag.engines.multi_agent.streaming_processor.types.Content"), patch(
      "src.smart_rag.engines.multi_agent.streaming_processor.types.Part"
    ), patch("src.smart_rag.engines.multi_agent.streaming_processor.RunConfig"):
      result = await processor.process_streaming_events(
        session_id="terminal-only", user_prompt="Hi",
        manager_agent=SimpleNamespace(id="mgr-1", name="Team Manager"),
        agent_runner=agent_runner, q=queue,
      )

    assert result == "Visible answer"
    assert _text_chunks(queue) == ["Visible answer"]

  @pytest.mark.asyncio
  @pytest.mark.parametrize(("streamed", "final", "expected_chunks"), [
    ("Visible answer", "Visible answer", ["Visible answer"]),
    ("Visible ", "Visible answer", ["Visible ", "answer"]),
  ])
  async def test_unguarded_output_reconciles_cumulative_final_text(
    self, processor, streamed, final, expected_chunks,
  ):
    queue = AsyncMock()

    async def fake_stream():
      yield _usage_event(streamed)
      yield _usage_event(final, is_final=True)

    agent_runner = MagicMock()
    agent_runner.run_async.return_value = fake_stream()
    with patch("src.smart_rag.engines.multi_agent.streaming_processor.types.Content"), patch(
      "src.smart_rag.engines.multi_agent.streaming_processor.types.Part"
    ), patch("src.smart_rag.engines.multi_agent.streaming_processor.RunConfig"):
      result = await processor.process_streaming_events(
        session_id="cumulative-final", user_prompt="Hi",
        manager_agent=SimpleNamespace(id="mgr-1", name="Team Manager"),
        agent_runner=agent_runner, q=queue,
      )

    assert result == final
    assert _text_chunks(queue) == expected_chunks

  @pytest.mark.asyncio
  async def test_unguarded_final_response_excludes_thought_parts(self, processor):
    queue = AsyncMock()
    event = _usage_event("", is_final=True)
    event.content.parts = [
      SimpleNamespace(text="Internal reasoning", thought=True, function_call=None, function_response=None),
      SimpleNamespace(text="Visible answer", thought=False, function_call=None, function_response=None),
    ]

    async def fake_stream():
      yield event

    agent_runner = MagicMock()
    agent_runner.run_async.return_value = fake_stream()
    with patch("src.smart_rag.engines.multi_agent.streaming_processor.types.Content"), patch(
      "src.smart_rag.engines.multi_agent.streaming_processor.types.Part"
    ), patch("src.smart_rag.engines.multi_agent.streaming_processor.RunConfig"):
      result = await processor.process_streaming_events(
        session_id="thought-final", user_prompt="Hi",
        manager_agent=SimpleNamespace(id="mgr-1", name="Team Manager"),
        agent_runner=agent_runner, q=queue,
      )

    assert result == "Visible answer"
    assert _text_chunks(queue) == ["Visible answer"]

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

  @pytest.mark.asyncio
  async def test_manager_emits_each_repeated_tool_occurrence(self, processor):
    queue = AsyncMock()
    queue.include_tool_results = True

    def event_for(part):
      return SimpleNamespace(
        content=SimpleNamespace(parts=[part]),
        usage_metadata=None,
        is_final_response=MagicMock(return_value=False),
      )

    events = [
      event_for(SimpleNamespace(text=None, function_call=SimpleNamespace(id="call-1", name="search", args={"q": "one", "path": "/mnt/workspace", "url": "https://user:password@example.test/private/report", "signed_url": "https://storage.example/private/report?X-Amz-Credential=private-scope&X-Amz-Signature=private-signature", "authorization": "Bearer private", "display_purpose": "Find the first source"}), function_response=None)),
      event_for(SimpleNamespace(text=None, function_call=SimpleNamespace(id="call-2", name="search", args={"q": "two", "display_purpose": "Find the second source"}), function_response=None)),
      event_for(SimpleNamespace(text="4 Files", thought=True, function_call=None, function_response=SimpleNamespace(id="call-1", name="search", response={"matches": 1, "url": "ws://sandbox.internal/session/abc123", "detail": "api_token=private"}, is_error=False))),
      event_for(SimpleNamespace(text=None, function_call=None, function_response=SimpleNamespace(id="call-2", name="search", response={"matches": 2}, is_error=False))),
    ]

    async def fake_stream():
      for event in events:
        yield event

    agent_runner = MagicMock()
    agent_runner.run_async.return_value = fake_stream()
    with patch("src.smart_rag.engines.multi_agent.streaming_processor.types.Content"), patch(
      "src.smart_rag.engines.multi_agent.streaming_processor.types.Part"
    ), patch("src.smart_rag.engines.multi_agent.streaming_processor.RunConfig"):
      await processor.process_streaming_events(
        session_id="sess-tools",
        user_prompt="search twice",
        manager_agent=SimpleNamespace(id="mgr-1", name="Team Manager"),
        agent_runner=agent_runner,
        q=queue,
      )

    tool_events = [
      call.args[0] for call in queue.put.await_args_list
      if isinstance(call.args[0], dict) and call.args[0].get("component", {}).get("type") == "tool_activity"
    ]
    assert [event["component"]["id"] for event in tool_events] == [
      "tool-mgr-1-call-1", "tool-mgr-1-call-2", "tool-mgr-1-call-1", "tool-mgr-1-call-2",
    ]
    assert [event["action"] for event in tool_events] == ["add", "add", "update", "update"]
    assert [event["component"]["data"].get("summary") for event in tool_events[:2]] == [
      "Find the first source", "Find the second source",
    ]
    activity_events = [
      call.args[0] for call in queue.put.await_args_list
      if isinstance(call.args[0], dict) and call.args[0].get("component", {}).get("type") == "agent_activity"
    ]
    assert activity_events == []
    assert all(
      "display_purpose" not in event["component"]["data"].get("params_json", "")
      and "_display_purpose" not in event["component"]["data"].get("params_json", "")
      for event in tool_events[:2]
    )
    assert "/mnt/workspace" in tool_events[0]["component"]["data"]["params_json"]
    assert "Bearer private" not in tool_events[0]["component"]["data"]["params_json"]
    assert "private-signature" not in tool_events[0]["component"]["data"]["params_json"]
    assert [event["component"]["data"].get("result_json") for event in tool_events] == [
      None, None, '{"matches":1,"url":"ws://sandbox.internal/session/abc123","detail":"api_token=[REDACTED]"}', '{"matches":2}',
    ]

  @pytest.mark.asyncio
  async def test_manager_emits_artifact_for_file_in_conversation_run(self, processor):
    queue = AsyncMock()
    queue.include_tool_results = True
    result = {
      "path": "/home/ubuntu/ai_two_sentences.pdf",
      "ceph_path": "user-1/system_conversation-1/ai_two_sentences.pdf",
    }

    def event_for(part):
      return SimpleNamespace(
        content=SimpleNamespace(parts=[part]),
        usage_metadata=None,
        is_final_response=MagicMock(return_value=False),
      )

    async def fake_stream():
      yield event_for(SimpleNamespace(
        text=None,
        function_call=SimpleNamespace(id="call-file", name="code_interpreter_send_file_to_user", args={"path": result["path"]}),
        function_response=None,
      ))
      yield event_for(SimpleNamespace(
        text=None,
        function_call=None,
        function_response=SimpleNamespace(id="call-file", name="code_interpreter_send_file_to_user", response=result, is_error=False),
      ))

    agent_runner = MagicMock()
    agent_runner.run_async.return_value = fake_stream()
    with patch("src.smart_rag.engines.multi_agent.streaming_processor.types.Content"), patch(
      "src.smart_rag.engines.multi_agent.streaming_processor.types.Part"
    ), patch("src.smart_rag.engines.multi_agent.streaming_processor.RunConfig"):
      await processor.process_streaming_events(
        session_id="conversation-1",
        user_prompt="create a PDF",
        manager_agent=SimpleNamespace(id="mgr-1", name="Team Manager"),
        agent_runner=agent_runner,
        q=queue,
      )

    artifacts = [
      call.args[0]["component"] for call in queue.put.await_args_list
      if call.args[0].get("component", {}).get("type") == "artifact"
    ]
    assert len(artifacts) == 1
    assert artifacts[0]["type"] == "artifact"
    assert artifacts[0]["id"].startswith("artifact-")
    assert artifacts[0]["data"] == {
      "artifact_kind": "document",
      "artifact_id": artifacts[0]["id"].removeprefix("artifact-"),
      "filename": "ai_two_sentences.pdf",
      "mime_type": "application/pdf",
      "size_bytes": 0,
      "availability": "ready",
      "file_path": "user-1/system_conversation-1/ai_two_sentences.pdf",
      "producer_tool_id": "tool-mgr-1-call-file",
      "output_port_id": "",
    }
