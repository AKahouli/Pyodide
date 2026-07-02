"""Extended unit tests for callback_helper module functions."""

import base64
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.smart_rag.infrastructure.processing.callback_helper import (
  add_additional_context,
  add_diagram_context_before_tool,
  add_timestamp_to_agent,
  append_suggested_agents,
  catch_diagram_after_tool,
  catch_images_after_tool,
  extract_html,
  modify_suggested_agents,
)


def _mock_callback_context(state=None):
  ctx = MagicMock()
  ctx.agent_name = "TestAgent"
  ctx.invocation_id = "inv-1"
  state_dict = state if state is not None else {}
  ctx.state = MagicMock()
  ctx.state.to_dict.return_value = state_dict
  ctx.state.get.side_effect = lambda key, default=None: state_dict.get(key, default)

  def _setitem(key, value):
    state_dict[key] = value

  def _getitem(key):
    return state_dict[key]

  ctx.state.__setitem__.side_effect = _setitem
  ctx.state.__getitem__.side_effect = _getitem
  return ctx, state_dict


class TestCallbackHelperExtended:
  def test_add_timestamp_to_agent_sets_time_once(self):
    ctx, state = _mock_callback_context()
    result = add_timestamp_to_agent(ctx)
    assert result is None
    assert "time" in state
    datetime.fromisoformat(state["time"])

    before = state["time"]
    add_timestamp_to_agent(ctx)
    assert state["time"] == before

  def test_append_suggested_agents_initializes_list(self):
    ctx, state = _mock_callback_context()
    result = append_suggested_agents(ctx)
    assert result is None
    assert state["suggested_agents"] == []

  def test_append_suggested_agents_preserves_existing(self):
    ctx, state = _mock_callback_context(
      {"suggested_agents": [{"name": "A", "description": "d"}]}
    )
    append_suggested_agents(ctx)
    assert state["last_suggested_agents"] == [{"name": "A", "description": "d"}]

  def test_modify_suggested_agents_deduplicates(self):
    ctx, state = _mock_callback_context(
      {
        "suggested_agents": [{"name": "Alpha", "description": "first"}],
        "last_suggested_agents": [
          {"name": "Alpha", "description": "first"},
          {"name": "Beta", "description": "second"},
        ],
      }
    )
    result = modify_suggested_agents(ctx)
    assert result is None
    names = {agent["name"] for agent in state["suggested_agents"]}
    assert names == {"Alpha", "Beta"}

  @pytest.mark.asyncio
  async def test_add_additional_context_non_delegation_injects_mcp(self):
    tool = MagicMock()
    tool.name = "perform_document_search"
    raw_tool = MagicMock()
    raw_tool.inputSchema = {
      "properties": {"user_id": {}, "workspace_id": {}, "file_name": {}}
    }
    tool.raw_mcp_tool = raw_tool
    args = {}
    tool_context = MagicMock()
    tool_context.state.to_dict.return_value = {
      "_mcp_search_user_id": "user-1",
      "_mcp_search_workspace_id": "ws-1",
      "_mcp_search_file_names": ["a.pdf"],
    }

    result = await add_additional_context(tool, args, tool_context)

    assert result is None
    assert args["user_id"] == "user-1"
    assert args["workspace_id"] == "ws-1"
    assert args["file_name"] == ["a.pdf"]

  @pytest.mark.asyncio
  async def test_add_additional_context_blocks_missing_expected_output(self):
    tool = MagicMock()
    tool.name = "delegate_to_writer_agent"
    tool_context = MagicMock()
    tool_context.state.get.return_value = False
    tool_context._invocation_context.session.events = []
    args = {"task_description": "do work"}

    result = await add_additional_context(tool, args, tool_context)

    assert result is not None
    assert "missing expected_output" in result["result"]

  def test_catch_images_after_tool_buffers_images(self):
    tool = MagicMock()
    tool.name = "perform_document_search"
    tool_context = MagicMock()
    tool_context.state = {}
    tool_response = {
      "sources_text": ["source-1"],
      "sources_image": [{"mime": "image/png", "data": "abc"}],
      "response_id": "resp-1",
      "list_of_filenames": ["img.png"],
    }

    result = catch_images_after_tool(tool, {}, tool_context, tool_response)

    assert "source-1" in result
    assert tool_context.state["text_order"] == 1
    assert "_pending_tool_images_resp-1" in tool_context.state

  def test_extract_html_from_markdown_fence(self):
    html = "<html><body><p>Hi</p></body></html>"
    wrapped = f"```html\n{html}\n```"
    assert extract_html(wrapped) == html

  def test_extract_html_returns_empty_for_plain_text(self):
    assert extract_html("no html here") == ""

  @pytest.mark.asyncio
  async def test_add_diagram_context_before_tool_injects_request(self):
    tool = MagicMock()
    tool.name = "delegate_to_HtmlAgent"
    tool_context = MagicMock()
    tool_context.agent_name = "manager"
    tool_context._invocation_context.session.events = []
    args = {"request": "Draw a chart"}

    result = await add_diagram_context_before_tool(tool, args, tool_context)

    assert result is None
    assert "context_from_calling_agent" in args["request"]
    assert "manager" in args["request"]

  @pytest.mark.asyncio
  async def test_catch_diagram_after_tool_stores_reference(self):
    tool = MagicMock()
    tool.name = "delegate_to_HtmlAgent"
    tool_context = MagicMock()
    tool_context._invocation_context.session.id = "sess-1"
    tool_context.state = {}
    html = "<html><body><p>Diagram</p></body></html>"
    args = {"task_description": "Create diagram"}

    mock_tracker = AsyncMock()
    mock_tracker.get_next_reference.return_value = 1
    mock_tracker.store_diagram = AsyncMock()

    with patch(
      "src.smart_rag.infrastructure.diagram.reference_tracker._global_diagram_tracker",
      mock_tracker,
    ):
      result = await catch_diagram_after_tool(
        tool, args, tool_context, html
      )

    assert "[diagram_1]" in result["result"]
    mock_tracker.store_diagram.assert_awaited_once()
