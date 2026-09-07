from __future__ import annotations

import pytest
from google.protobuf.json_format import MessageToDict

from src.flow_engine.observability.trace_collector import TraceCollector
from src.flow_engine.observability.redaction import (
    MAX_TRACE_KEY_LENGTH,
    MAX_TRACE_VALUE_DEPTH,
    MAX_TRACE_VALUE_ITEMS,
    MAX_TRACE_VALUE_LENGTH,
)


def test_trace_collector_preserves_internal_trace_values_and_accumulates_usage() -> None:
    collector = TraceCollector()

    collector.record_prompt("initial_request", "gpt-4o-mini", "Bearer secret")
    collector.record_prompt_output("generated Bearer secret")
    collector.record_tool_call(
        tool_name="search",
        args={"authorization": "Bearer abc", "query": "hello"},
        output_summary="result",
        status="completed",
        duration_ms=12,
    )

    from src.flow_engine.observability.trace_types import UsageSummary

    collector.record_usage(UsageSummary(input_tokens=1, output_tokens=2, total_tokens=3, model="gpt-4o-mini"))
    collector.record_usage(UsageSummary(input_tokens=4, output_tokens=5, total_tokens=9, model="gpt-4o-mini"))

    payload = collector.build_payload()

    assert payload["llm_prompt_trace"] == [{
        "stage": "initial_request",
        "model": "gpt-4o-mini",
        "prompt": "Bearer secret",
        "generated_output": "generated Bearer secret",
    }]
    assert payload["tool_trace"] == [{
        "call_index": 0,
        "tool_name": "search",
        "args": {"authorization": "Bearer abc", "query": "hello"},
        "output_summary": "result",
        "status": "completed",
        "duration_ms": 12,
        "error": None,
    }]
    assert payload["usage"] == {"input_tokens": 5, "output_tokens": 7, "total_tokens": 12, "model": "gpt-4o-mini"}


def test_trace_collector_bounds_raw_tool_arguments() -> None:
    collector = TraceCollector()
    collector.record_tool_call(
        tool_name="search",
        args={f"key-{index}": "x" * (MAX_TRACE_VALUE_LENGTH + 100) for index in range(MAX_TRACE_VALUE_ITEMS + 10)},
        output_summary=None,
        status="completed",
        duration_ms=1,
    )

    args = collector.build_payload()["tool_trace"][0]["args"]
    assert len(args) == MAX_TRACE_VALUE_ITEMS
    assert len(args["key-0"]) == MAX_TRACE_VALUE_LENGTH + 3


def test_trace_collector_drops_oversized_keys_and_bounds_depth() -> None:
    nested = "leaf"
    for _ in range(MAX_TRACE_VALUE_DEPTH + 2):
        nested = {"nested": nested}
    collector = TraceCollector()
    collector.record_tool_call(
        tool_name="search",
        args={"k" * (MAX_TRACE_KEY_LENGTH + 1): "secret", "deep": nested},
        output_summary=None,
        status="completed",
        duration_ms=1,
    )

    args = collector.build_payload()["tool_trace"][0]["args"]
    assert list(args) == ["deep"]
    assert "[TRUNCATED]" in str(args["deep"])


@pytest.mark.asyncio
async def test_run_step_with_tools_records_failed_tool_call(monkeypatch) -> None:
    from src.flow_engine.tests.step_agent_test_helper import run_step_with_tools

    class _Response:
        def __init__(self) -> None:
            self.model = "gpt-4o-mini"
            self.usage = type("Usage", (), {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3})()
            self.choices = [type("Choice", (), {"message": {"content": "", "tool_calls": [{"id": "1", "type": "function", "function": {"name": "search", "arguments": "{}"}}]}})()]

    class _Tool:
        name = "search"
        description = "search"
        args_schema = None

        async def ainvoke(self, _args):
            raise RuntimeError("tool failed")

    collector = TraceCollector()

    async def fake_acompletion(**_kwargs):
        return _Response()

    monkeypatch.setattr("src.flow_engine.agent_runtime.model.litellm.acompletion", fake_acompletion)

    with pytest.raises(RuntimeError, match="tool failed"):
        await run_step_with_tools(
            model_id="gpt-4o-mini",
            system_prompt="system",
            user_msg="user",
            tools=[_Tool()],
            trace_collector=collector,
        )

    payload = collector.build_payload()
    assert payload["tool_trace"][0]["tool_name"] == "search"
    assert payload["tool_trace"][0]["status"] == "failed"
    assert payload["usage"]["total_tokens"] == 3


def test_trace_collector_includes_observed_intent_key_when_set() -> None:
    collector = TraceCollector()
    collector.set_observed_intent_key("verify-facts-analysis")

    payload = collector.build_payload()

    assert payload["trace_metadata"]["observed_intent_key"] == "verify-facts-analysis"


def test_trace_collector_omits_observed_intent_key_when_not_set() -> None:
    collector = TraceCollector()

    payload = collector.build_payload()

    assert "observed_intent_key" not in payload["trace_metadata"]


def test_trace_collector_omits_observed_intent_key_when_set_to_none() -> None:
    collector = TraceCollector()
    collector.set_observed_intent_key(None)

    payload = collector.build_payload()

    assert "observed_intent_key" not in payload["trace_metadata"]


@pytest.mark.asyncio
async def test_run_step_with_tools_records_child_tool_calls_by_child_name(monkeypatch) -> None:
    from src.flow_engine.tests.step_agent_test_helper import run_step_with_tools
    from src.temporary_child_summary import (
        pop_temporary_child_summary,
        record_temporary_child_start,
    )

    class _Response:
        def __init__(self, content: str, tool_calls=None) -> None:
            self.model = "gpt-4o-mini"
            self.usage = type("Usage", (), {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3})()
            self.choices = [
                type("Choice", (), {"message": {"content": content, "tool_calls": tool_calls or []}})()
            ]

    class _Tool:
        name = "search"
        description = "search"
        args_schema = None

        async def ainvoke(self, _args):
            return "Bearer child-secret"

    session_id = "flow-child-tool-call-test"
    child_name = "Research Agent:flow_tmp_1"
    pop_temporary_child_summary(session_id)
    record_temporary_child_start(
        session_id=session_id,
        parent="Research Agent",
        child=child_name,
        task_description="task",
    )
    responses = [
        _Response(
            "",
            [{
                "id": "call-search",
                "type": "function",
                "function": {"name": "search", "arguments": '{"query":"revenue"}'},
            }],
        ),
        _Response("Done."),
    ]

    async def fake_acompletion(**_kwargs):
        return responses.pop(0)

    monkeypatch.setattr("src.flow_engine.agent_runtime.model.litellm.acompletion", fake_acompletion)
    collector = TraceCollector()
    trace_update_count = 0

    def record_trace_update() -> None:
        nonlocal trace_update_count
        trace_update_count += 1

    output = await run_step_with_tools(
        model_id="gpt-4o-mini",
        system_prompt="system",
        user_msg="user",
        tools=[_Tool()],
        agent_role="temporary_child",
        agent_name=child_name,
        summary_session_id=session_id,
        trace_collector=collector,
        on_trace_update=record_trace_update,
    )

    summary = pop_temporary_child_summary(session_id)
    tool_calls = summary["children"][0]["tool_calls"]
    payload = collector.build_payload()
    assert output == "Done."
    assert [call["status"] for call in tool_calls] == ["requested", "completed"]
    assert {call["child"] for call in tool_calls} == {child_name}
    assert tool_calls[-1]["result_preview"] == "Bearer [REDACTED]"
    assert payload["tool_trace"][0]["output_summary"] == "Bearer child-secret"
    assert payload["tool_trace"][0]["agent_name"] == child_name
    assert payload["tool_trace"][0]["agent_role"] == "temporary_child"
    assert trace_update_count >= 1


@pytest.mark.asyncio
async def test_emit_events_forwards_node_trace_update_payload() -> None:
    from src.flow_engine.runtime.events import emit_events

    async def stream():
        yield {
            "_mode": "custom",
            "_data": {
                "type": "NodeTraceUpdate",
                "node_id": "step-1",
                "iteration": 1,
                "payload": {
                    "llm_prompt_trace": [{
                        "stage": "initial_request",
                        "model": "gpt-5.4-mini",
                        "prompt": "prompt",
                        "generated_output": "answer",
                    }],
                    "tool_trace": [],
                },
            },
        }

    events = [event async for event in emit_events("exec-1", stream())]

    assert len(events) == 1
    assert events[0].event_type == "NodeTraceUpdate"
    assert events[0].node_id == "step-1"
    assert events[0].iteration == 1
    payload = MessageToDict(events[0].payload, preserving_proto_field_name=True)
    assert payload["llm_prompt_trace"][0]["generated_output"] == "answer"
