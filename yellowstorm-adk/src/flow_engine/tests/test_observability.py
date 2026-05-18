from __future__ import annotations

import pytest

from src.flow_engine.observability.trace_collector import TraceCollector


def test_trace_collector_redacts_and_accumulates_usage() -> None:
    collector = TraceCollector()

    collector.record_prompt("initial_request", "gpt-4o-mini", "Bearer secret")
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

    assert payload["llm_prompt_trace"] == [{"stage": "initial_request", "model": "gpt-4o-mini", "prompt": "Bearer [REDACTED]"}]
    assert payload["tool_trace"] == [{
        "call_index": 0,
        "tool_name": "search",
        "args": {"authorization": "[REDACTED]", "query": "hello"},
        "output_summary": "result",
        "status": "completed",
        "duration_ms": 12,
        "error": None,
    }]
    assert payload["usage"] == {"input_tokens": 5, "output_tokens": 7, "total_tokens": 12, "model": "gpt-4o-mini"}


@pytest.mark.asyncio
async def test_run_step_with_tools_records_failed_tool_call(monkeypatch) -> None:
    from src.flow_engine.nodes.step_tools import run_step_with_tools

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

    monkeypatch.setattr("src.flow_engine.nodes.step_tools.litellm.acompletion", fake_acompletion)

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
