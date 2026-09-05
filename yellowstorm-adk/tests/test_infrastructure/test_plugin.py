"""Unit tests for smart_rag processing plugin module."""

import asyncio
import base64
import copy
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


def _function_response_event(call_id="call-1", name="delegate_to_search_agent"):
  func_resp = SimpleNamespace(id=call_id, name=name)
  part = SimpleNamespace(function_call=None, function_response=func_resp)
  return SimpleNamespace(content=SimpleNamespace(parts=[part]))


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
    responded_event = _function_response_event()
    call_event = _function_call_event(call_id="call-1")
    session = SimpleNamespace(events=[call_event, responded_event], last_update_time=1.0)
    invocation_context = SimpleNamespace(session=session, session_service=AsyncMock())

    result = await clean_session_case_bad_request(invocation_context, user_message=None)

    assert result is None
    invocation_context.session_service.append_event.assert_not_awaited()

  @pytest.mark.asyncio
  async def test_clean_session_reconciles_all_missing_calls_without_duplicates(self):
    first_call = _function_call_event(call_id="missing-1", name="first_tool")
    second_call = _function_call_event(call_id="completed-1", name="completed_tool")
    second_call.content.parts.append(
      _function_call_event(call_id="missing-2", name="second_tool").content.parts[0]
    )
    session = SimpleNamespace(
      events=[first_call, second_call, _function_response_event("completed-1")],
      last_update_time=5.0,
    )

    async def append_event(current_session, event):
      current_session.events.append(event)

    session_service = SimpleNamespace(append_event=AsyncMock(side_effect=append_event))
    invocation_context = SimpleNamespace(session=session, session_service=session_service)

    await clean_session_case_bad_request(invocation_context, user_message=None)
    await clean_session_case_bad_request(invocation_context, user_message=None)

    assert session_service.append_event.await_count == 2
    recovered = [
      part.function_response
      for event in session.events[3:]
      for part in event.content.parts
    ]
    assert [(response.id, response.name) for response in recovered] == [
      ("missing-1", "first_tool"),
      ("missing-2", "second_tool"),
    ]
    assert all(response.will_continue is False for response in recovered)
    assert all("error" in response.response for response in recovered)

  @pytest.mark.asyncio
  async def test_concurrent_cleaners_converge_on_one_recovery_response(self):
    first_call = _function_call_event(call_id="missing-1", name="removed_tool")
    second_call = _function_call_event(call_id="missing-2", name="other_removed_tool")
    stored_session = SimpleNamespace(
      app_name="manager_app",
      user_id="user-1",
      id="session-1",
      events=[first_call, second_call],
      last_update_time=5.0,
      _storage_update_marker=0,
    )
    append_lock = asyncio.Lock()
    winner_finished = asyncio.Event()

    async def append_event(session, event):
      nonlocal stored_session
      if session.client == "loser":
        await winner_finished.wait()
      async with append_lock:
        if session._storage_update_marker != stored_session._storage_update_marker:
          raise ValueError("The session has been modified in storage")
        stored_session.events.append(event)
        stored_session._storage_update_marker += 1
        session.events.append(event)
        session._storage_update_marker = stored_session._storage_update_marker
        if stored_session._storage_update_marker == 2:
          winner_finished.set()

    async def get_session(**_kwargs):
      return copy.deepcopy(stored_session)

    session_service = SimpleNamespace(
      append_event=AsyncMock(side_effect=append_event),
      get_session=AsyncMock(side_effect=get_session),
    )
    winner_session = copy.deepcopy(stored_session)
    winner_session.client = "winner"
    loser_session = copy.deepcopy(stored_session)
    loser_session.client = "loser"
    contexts = [
      SimpleNamespace(session=winner_session, session_service=session_service),
      SimpleNamespace(session=loser_session, session_service=session_service),
    ]

    await asyncio.gather(*(
      clean_session_case_bad_request(context, user_message=None)
      for context in contexts
    ))

    recovered = [
      part.function_response
      for event in stored_session.events
      for part in event.content.parts
      if getattr(part, "function_response", None)
    ]
    assert [response.id for response in recovered] == ["missing-1", "missing-2"]
    assert session_service.get_session.await_count == 1

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
