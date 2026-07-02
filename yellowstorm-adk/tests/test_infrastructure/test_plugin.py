"""Unit tests for smart_rag processing plugin module."""

import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.smart_rag.infrastructure.processing.plugin import (
  CleanSessionPlugin,
  clean_session_case_bad_request,
  make_empty_function_response_event,
  process_image_inputs,
)


def _function_call_event(call_id="call-1", name="delegate_to_search_agent"):
  func_call = SimpleNamespace(id=call_id, name=name)
  part = SimpleNamespace(function_call=func_call, function_response=None, text=None)
  content = SimpleNamespace(parts=[part], role="model")
  return SimpleNamespace(id="event-1", content=content, timestamp=1.0)


class TestPluginModule:
  def test_make_empty_function_response_event_replaces_function_call(self):
    session = SimpleNamespace(last_update_time=10.0)
    call_event = _function_call_event()

    response_event = make_empty_function_response_event(
      session, call_event, response_dict={"result": "stopped"}
    )

    assert response_event.id != call_event.id
    assert response_event.timestamp == pytest.approx(10.0 + 1e-6)
    part = response_event.content.parts[0]
    assert part.function_response.response == {"result": "stopped"}
    assert part.function_response.name == "delegate_to_search_agent"

  @pytest.mark.asyncio
  async def test_clean_session_appends_missing_function_response(self):
    call_event = _function_call_event(call_id="missing-1")
    session = SimpleNamespace(events=[call_event], last_update_time=5.0)
    session_service = AsyncMock()
    invocation_context = SimpleNamespace(session=session, session_service=session_service)

    with patch(
      "src.smart_rag.infrastructure.processing.plugin.make_empty_function_response_event"
    ) as mock_make:
      mock_make.return_value = SimpleNamespace(id="resp-event")
      await clean_session_case_bad_request(invocation_context, user_message=None)

    session_service.append_event.assert_awaited_once()

  @pytest.mark.asyncio
  async def test_clean_session_no_missing_calls_returns_none(self):
    func_resp = SimpleNamespace(id="call-1", name="fn")
    part = SimpleNamespace(function_call=None, function_response=func_resp)
    responded_event = SimpleNamespace(
      content=SimpleNamespace(parts=[part]),
    )
    call_event = _function_call_event(call_id="call-1")
    session = SimpleNamespace(events=[call_event, responded_event], last_update_time=1.0)
    invocation_context = SimpleNamespace(session=session, session_service=AsyncMock())

    result = await clean_session_case_bad_request(invocation_context, user_message=None)

    assert result is None
    invocation_context.session_service.append_event.assert_not_awaited()

  def test_process_image_inputs_stores_pending_images(self):
    image_b64 = base64.b64encode(b"fake-image").decode("ascii")
    state = {
      "image_input": [{"chart.png": image_b64}],
    }
    invocation_context = SimpleNamespace(state=state)

    process_image_inputs(invocation_context)

    assert state["_pending_tool_images"][0]["data"] == image_b64
    assert state["_list_of_filenames"] == ["chart.png"]
    assert state["image_input"] == []

  def test_process_image_inputs_ignores_invalid_payload(self):
    state = {"image_input": "not-a-list"}
    invocation_context = SimpleNamespace(state=MagicMock())
    invocation_context.state.to_dict.return_value = dict(state)

    process_image_inputs(invocation_context)

    assert "_pending_tool_images" not in state

  @pytest.mark.asyncio
  async def test_clean_session_plugin_on_user_message_callback(self):
    plugin = CleanSessionPlugin()
    invocation_context = SimpleNamespace(
      session=SimpleNamespace(events=[], last_update_time=0.0),
      session_service=None,
      state=MagicMock(),
    )
    invocation_context.state.to_dict.return_value = {}

    with patch(
      "src.smart_rag.infrastructure.processing.plugin.clean_session_case_bad_request",
      new_callable=AsyncMock,
    ) as mock_clean, patch(
      "src.smart_rag.infrastructure.processing.plugin.process_image_inputs"
    ) as mock_images:
      result = await plugin.on_user_message_callback(
        invocation_context=invocation_context,
        user_message=MagicMock(),
      )

    assert result is None
    mock_clean.assert_awaited_once()
    mock_images.assert_called_once_with(invocation_context)
