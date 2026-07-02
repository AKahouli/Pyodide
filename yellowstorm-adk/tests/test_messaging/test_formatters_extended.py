"""Extended unit tests for StreamingFormatter methods."""

import json
from unittest.mock import MagicMock

import pytest

from src.smart_rag.messaging.component_tracker import ComponentTracker
from src.smart_rag.messaging.formatters import StreamingFormatter


class TestStreamingFormatterExtended:
  def test_agent_name_stream_normalizes_names(self):
    formatter = StreamingFormatter()
    assert formatter.agent_name_stream("search_agent") == "Search Agent"
    assert formatter.agent_name_stream("report-writer") == "Report Writer"
    assert formatter.agent_name_stream("O'Neil_agent") == "O'Neil Agent"

  def test_format_component_event_with_tracker(self):
    tracker = ComponentTracker("sess-1")
    formatter = StreamingFormatter(component_tracker=tracker)

    event = formatter.format_component_event(
      agent_id="agent-1",
      component_type="text",
      component_data={"content": "hello"},
      message_id="msg-1",
    )

    assert event["action"] == "add"
    assert event["component"]["type"] == "text"
    assert event["metadata"]["agent_id"] == "agent-1"

  def test_format_component_event_manual_component_id(self):
    formatter = StreamingFormatter()
    event = formatter.format_component_event(
      agent_id="agent-1",
      component_type="text",
      component_data={"content": "hello"},
      message_id="msg-1",
      component_id="fixed-id",
    )
    assert event["component"]["id"] == "fixed-id"
    assert event["action"] == "add"

  def test_format_plan_events_first_send_add_only(self):
    tracker = ComponentTracker("sess-plan")
    formatter = StreamingFormatter(component_tracker=tracker)
    plan_data = {"title": "Plan", "steps": []}

    events = formatter.format_plan_events("manager", plan_data, "msg-1")

    assert len(events) == 1
    assert events[0]["action"] == "add"
    assert events[0]["component"]["type"] == "plan"

  def test_format_plan_events_subsequent_delete_then_add(self):
    tracker = ComponentTracker("sess-plan-2")
    formatter = StreamingFormatter(component_tracker=tracker)
    plan_data = {"title": "Plan", "steps": []}
    formatter.format_plan_events("manager", plan_data, "msg-1")

    events = formatter.format_plan_events("manager", plan_data, "msg-1")

    assert len(events) == 2
    assert events[0]["action"] == "delete"
    assert events[1]["action"] == "add"

  def test_format_streaming_event_uses_component_tracker(self):
    tracker = ComponentTracker("sess-comp")
    formatter = StreamingFormatter(component_tracker=tracker)

    event = formatter.format_streaming_event(
      agent_name="writer_agent",
      agent_type="agent",
      chunk="streaming text",
      message_id="msg-2",
      agent_id="agent-42",
    )

    assert event["action"] == "add"
    assert event["component"]["type"] == "text"
    assert event["component"]["data"]["content"] == "streaming text"

  def test_format_search_event_internal_and_web(self):
    internal = StreamingFormatter.format_search_event(
      agent_name="search_agent",
      search_type="internal",
      query="revenue",
      message_id="msg-3",
      agent_id="agent-1",
    )
    web = StreamingFormatter.format_search_event(
      agent_name="search_agent",
      search_type="web",
      query="news",
      message_id="msg-3",
      agent_id="agent-1",
    )

    assert "recherche interne" in internal["chunk"]
    assert "web search" in web["chunk"]

  def test_format_search_event_update_existing_component(self):
    event = StreamingFormatter.format_search_event(
      agent_name="search_agent",
      search_type="internal",
      query="docs",
      message_id="msg-4",
      agent_id="agent-1",
      component_id="comp-99",
    )
    assert event["action"] == "update"
    assert event["component"]["id"] == "comp-99"
    assert event["component"]["data"]["content"].startswith("\n\n")

  def test_format_calculation_source_file_error_events(self):
    calc = StreamingFormatter.format_calculation_event(
      "calc_agent", "2+2", "msg-5", "agent-1"
    )
    source = StreamingFormatter.format_source_event(
      "search_agent", [{"id": 1}], "msg-5", "agent-1"
    )
    file_event = StreamingFormatter.format_file_event(
      "uploader", {"name": "a.pdf"}, "msg-5", "agent-1"
    )
    error = StreamingFormatter.format_error_event(
      "agent", "failed", "msg-5", "agent-1"
    )

    assert "Calculating" in calc["chunk"]
    assert json.loads(source["chunk"]) == [{"id": 1}]
    assert json.loads(file_event["chunk"])["name"] == "a.pdf"
    assert "Error: failed" in error["chunk"]

  def test_format_final_response_and_html_chunk(self):
    final = StreamingFormatter.format_final_response_event(
      "manager", "msg-6", "manager-id"
    )
    html = StreamingFormatter.format_html_chunk_event(
      "<p>chunk</p>", "msg-6", "html-id"
    )

    assert final["content_type"] == "final_response"
    assert html["agent_type"] == "html"

  def test_split_and_format_large_content(self):
    content = "x" * 600
    events = StreamingFormatter.split_and_format_large_content(
      content, "msg-7", chunk_size=250
    )
    assert len(events) == 3
    assert sum(len(event["chunk"]) for event in events) == 600

  def test_create_search_events_for_function(self):
    doc_event = StreamingFormatter.create_search_events_for_function(
      "perform_document_search",
      {"query": "annual report", "year": 2024},
      "search_agent",
      "msg-8",
      agent_id="agent-1",
    )
    calc_event = StreamingFormatter.create_search_events_for_function(
      "calculator",
      {"expression": "3*7"},
      "calc_agent",
      "msg-8",
      agent_id="agent-1",
    )
    none_event = StreamingFormatter.create_search_events_for_function(
      "unknown_fn", {}, "agent", "msg-8"
    )

    assert "annual report" in doc_event["chunk"]
    assert "Calculating" in calc_event["chunk"]
    assert none_event is None

  def test_validate_event_format(self):
    valid = {
      "agent_name": "A",
      "agent_type": "agent",
      "chunk": "c",
      "message_id": "m",
      "message_type": "streaming",
      "content_type": "chunk",
    }
    assert StreamingFormatter.validate_event_format(valid) is True
    assert StreamingFormatter.validate_event_format({"chunk": "only"}) is False
