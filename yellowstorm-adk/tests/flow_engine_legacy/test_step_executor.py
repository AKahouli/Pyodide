import asyncio
import sys
from types import SimpleNamespace

import pytest

from src.flow_engine.legacy.step_executor import (
    _execute_with_tools,
    _attach_result_text_for_citations,
    _collect_generated_artifacts,
    _execute_evaluation_task,
    _build_plain_text_artifact,
    _build_task_artifacts_from_structured_outputs,
    _determine_output_mode,
    _execute_replay_tool_calls,
    _extract_json_object,
    _finalize_task_outputs,
    _parse_structured_final_response,
    _task_requires_structured_output_synthesis,
    _validate_declared_output_ports,
)


@pytest.mark.asyncio
async def test_execute_with_tools_streams_parallel_tool_progress_in_call_order(
    monkeypatch,
) -> None:
    class FakeTool:
        def __init__(self, name: str, delay: float, result: str) -> None:
            self.name = name
            self.delay = delay
            self.result = result

        async def ainvoke(self, args):
            await asyncio.sleep(self.delay)
            return f"{self.result}:{args['value']}"

    class FakeBoundLLM:
        def __init__(self) -> None:
            self.calls = 0

        async def ainvoke(self, messages):
            self.calls += 1
            if self.calls == 1:
                return SimpleNamespace(
                    content="",
                    tool_calls=[
                        {"id": "call-1", "name": "slow_tool", "args": {"value": "A"}},
                        {"id": "call-2", "name": "fast_tool", "args": {"value": "B"}},
                    ],
                    response_metadata={},
                )
            return SimpleNamespace(
                content="done",
                tool_calls=[],
                response_metadata={},
            )

    class FakeChatOpenAI:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs

        def bind_tools(self, tools):
            return FakeBoundLLM()

    monkeypatch.setitem(
        sys.modules,
        "langchain_openai",
        SimpleNamespace(ChatOpenAI=FakeChatOpenAI),
    )

    progress_events = []

    async def on_progress(payload):
        progress_events.append(payload)

    response, _, _, tool_trace, _ = await _execute_with_tools(
        settings=SimpleNamespace(
            LITELLM_API_BASE_URL="http://example.test",
            LITELLM_API_SECRET_KEY="secret",
        ),
        model_name="fake-model",
        system_prompt="system",
        user_prompt="user",
        tools=[
            FakeTool("slow_tool", delay=0.03, result="slow"),
            FakeTool("fast_tool", delay=0.01, result="fast"),
        ],
        on_progress=on_progress,
        stream_final_output=False,
    )

    assert response == "done"
    assert len(progress_events) == 3

    initial_trace = progress_events[0]["tool_trace"]
    intermediate_trace = progress_events[1]["tool_trace"]
    final_trace = progress_events[2]["tool_trace"]

    assert [item["call_index"] for item in initial_trace] == [1, 2]
    assert [item["tool_name"] for item in initial_trace] == ["slow_tool", "fast_tool"]
    assert [item["output_summary"] for item in initial_trace] == ["Running...", "Running..."]

    assert [item["call_index"] for item in intermediate_trace] == [1, 2]
    assert intermediate_trace[0]["tool_name"] == "slow_tool"
    assert intermediate_trace[0]["output_summary"] == "Running..."
    assert intermediate_trace[1]["tool_name"] == "fast_tool"
    assert intermediate_trace[1]["output_summary"] == "fast:B"

    assert final_trace == [
        {
            "call_index": 1,
            "tool_name": "slow_tool",
            "args": {"value": "A"},
            "output_summary": "slow:A",
        },
        {
            "call_index": 2,
            "tool_name": "fast_tool",
            "args": {"value": "B"},
            "output_summary": "fast:B",
        },
    ]
    assert tool_trace == final_trace
    assert [item["output_summary"] for item in initial_trace] == ["Running...", "Running..."]


@pytest.mark.asyncio
async def test_replay_tool_calls_resolve_filtered_search_aliases() -> None:
    class FakeTool:
        def __init__(self, name: str) -> None:
            self.name = name

        async def ainvoke(self, args):
            return f"ok:{self.name}:{args['query']}"

    response, _components, tool_trace, synthesis_context = await _execute_replay_tool_calls(
        tools=[FakeTool("perform_standard_search")],
        collector=None,
        validated_replay={
            "replay_id": "r1",
            "task_id": "t1",
            "reference_output": "baseline",
            "tool_calls": [
                {
                    "call_index": 1,
                    "tool_name": "perform_filtered_search",
                    "args": {"query": "revenue"},
                }
            ],
        },
    )

    assert response == "baseline"
    assert tool_trace[0]["tool_name"] == "perform_filtered_search"
    assert "perform_filtered_search" in synthesis_context


@pytest.mark.asyncio
async def test_replay_tool_calls_resolve_connector_action_key_suffix() -> None:
    class FakeTool:
        def __init__(self, name: str) -> None:
            self.name = name

        async def ainvoke(self, args):
            return f"ok:{self.name}:{args['query']}"

    response, _components, tool_trace, synthesis_context = await _execute_replay_tool_calls(
        tools=[FakeTool("sharepoint_perform_filtered_search")],
        collector=None,
        validated_replay={
            "replay_id": "r2",
            "task_id": "t2",
            "reference_output": "baseline",
            "tool_calls": [
                {
                    "call_index": 1,
                    "tool_name": "perform_filtered_search",
                    "args": {"query": "forecast"},
                }
            ],
        },
    )

    assert response == "baseline"
    assert tool_trace[0]["tool_name"] == "perform_filtered_search"
    assert "forecast" in synthesis_context


@pytest.mark.asyncio
async def test_execute_evaluation_task_uses_prompt_registry_and_emits_data_artifact(
    monkeypatch,
) -> None:
    from src.flow_engine.legacy import step_executor as module

    async def fake_llm_call(
        settings,
        model_name,
        system_prompt,
        user_prompt,
        temperature=0.7,
        prompt_trace=None,
        stage="",
        on_progress=None,
    ):
        assert system_prompt == "SYSTEM"
        assert "Expected result:" in user_prompt
        assert "Revenue and Costs by product" in user_prompt
        return (
            '{"score": 88, "verdict": "pass", "summary": "Looks good.", "semanticScore": 90, "referenceScore": 80, "artifactScore": 85, "formatScore": 84, "evidenceScore": 92, "executionHealthScore": 75, "findings": [{"severity": "info", "category": "semantic", "sourceTaskId": "source-a", "message": "ok"}] }',
            {"input_tokens": 1, "output_tokens": 2, "total_tokens": 3, "model": model_name},
        )

    monkeypatch.setattr(module, "_llm_call", fake_llm_call)

    result = await _execute_evaluation_task(
        task={
            "id": "eval-1",
            "title": "Financial Evaluation",
            "description": "Check final finance outputs",
            "output_ports": [{"id": "evaluation", "artifact_kind": "data"}],
            "evaluation_config": {
                "expectation": "Revenue and Costs by product",
                "reference_baseline_id": "baseline-1",
                "pass_threshold": 80,
                "warning_threshold": 60,
                "weights": {"semanticMatch": 40},
            },
        },
        resolved_inputs={
            "resolved_inputs": {"evidence": "sample"},
            "upstream_bindings": {"evidence": [{"source_task_id": "source-a"}]},
            "artifacts_by_port": {"source-a:out": [{"artifact_kind": "text", "content": "sample"}]},
        },
        prompt_registry={
            "evaluation.task.system": {"systemTemplate": "SYSTEM"},
            "evaluation.task.user": {"userTemplate": "Expected result:\n{{expectation}}\n\nReference baseline:\n{{baselineSummary}}\n\nConnected inputs JSON:\n{{inputsJson}}\n\nRubric JSON:\n{{rubricJson}}"},
        },
        settings=SimpleNamespace(),
        model_name="test-model",
        temperature=0.2,
        evaluator_name="Finance Evaluator",
        evaluator_instructions="Judge finance outputs strictly.",
    )

    assert result["output"] == "Looks good."
    assert result["artifacts"][0]["artifact_kind"] == "data"
    assert result["artifacts"][0]["data"]["type"] == "playbook_evaluation_result"
    assert result["artifacts"][0]["data"]["score"] == 88


def test_task_requires_structured_output_synthesis_for_multiple_ports() -> None:
    assert _task_requires_structured_output_synthesis(
        {
            "output_ports": [
                {"id": "summary", "artifact_kind": "text"},
                {"id": "context", "artifact_kind": "text"},
            ]
        }
    ) is False

    assert _task_requires_structured_output_synthesis(
        {
            "output_ports": [
                {"id": "pdf", "artifact_kind": "document"},
                {"id": "ppt", "artifact_kind": "document"},
            ]
        }
    ) is True


def test_determine_output_mode_prefers_plain_for_single_text_output() -> None:
    assert _determine_output_mode(
        {"output_ports": [{"id": "summary", "artifact_kind": "text"}]}
    ) == "plain"


def test_determine_output_mode_prefers_plain_for_multiple_text_ports() -> None:
    assert _determine_output_mode(
        {
            "output_ports": [
                {"id": "summary", "artifact_kind": "text"},
                {"id": "context", "artifact_kind": "text"},
            ]
        }
    ) == "plain"


def test_determine_output_mode_uses_structured_for_single_document_port() -> None:
    assert _determine_output_mode(
        {"output_ports": [{"id": "report", "artifact_kind": "document"}]}
    ) == "structured_final_response"


def test_determine_output_mode_uses_structured_for_single_code_port() -> None:
    assert _determine_output_mode(
        {"output_ports": [{"id": "script", "artifact_kind": "code"}]}
    ) == "structured_final_response"


def test_determine_output_mode_uses_structured_for_multiple_document_ports() -> None:
    assert _determine_output_mode(
        {
            "output_ports": [
                {"id": "pdf", "artifact_kind": "document"},
                {"id": "slides", "artifact_kind": "document"},
            ]
        }
    ) == "structured_final_response"


def test_determine_output_mode_uses_structured_for_multiple_distinct_ports() -> None:
    assert _determine_output_mode(
        {
            "output_ports": [
                {"id": "summary", "artifact_kind": "text"},
                {"id": "metrics", "artifact_kind": "data"},
            ]
        }
    ) == "structured_final_response"


def test_build_task_artifacts_from_structured_outputs_routes_multiple_text_ports() -> None:
    artifacts = _build_task_artifacts_from_structured_outputs(
        {
            "output_ports": [
                {"id": "summary", "artifact_kind": "text"},
                {"id": "context", "artifact_kind": "text"},
            ]
        },
        [
            {
                "output_port_id": "summary",
                "artifact_kind": "text",
                "content": "Executive summary",
            },
            {
                "output_port_id": "context",
                "artifact_kind": "text",
                "content": "Detailed context",
            },
        ],
        [],
    )

    assert artifacts == [
        {
            "port_id": "summary",
            "artifact_kind": "text",
            "content": "Executive summary",
        },
        {
            "port_id": "context",
            "artifact_kind": "text",
            "content": "Detailed context",
        },
    ]


def test_build_task_artifacts_from_structured_outputs_maps_generated_files_by_filename() -> None:
    artifacts = _build_task_artifacts_from_structured_outputs(
        {
            "output_ports": [
                {"id": "client_pdf", "artifact_kind": "document"},
                {"id": "slides", "artifact_kind": "document"},
            ]
        },
        [
            {
                "output_port_id": "client_pdf",
                "artifact_kind": "document",
                "content": {"filename": "client-report.pdf"},
            },
            {
                "output_port_id": "slides",
                "artifact_kind": "document",
                "content": {"filename": "briefing.pptx"},
            },
        ],
        [
            {
                "file_path": "https://example.com/client-report.pdf",
                "filename": "client-report.pdf",
                "mime_type": "application/pdf",
            },
            {
                "file_path": "https://example.com/briefing.pptx",
                "filename": "briefing.pptx",
                "mime_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            },
        ],
    )

    assert artifacts == [
        {
            "port_id": "client_pdf",
            "artifact_kind": "document",
            "url": "https://example.com/client-report.pdf",
            "filename": "client-report.pdf",
            "mime_type": "application/pdf",
        },
        {
            "port_id": "slides",
            "artifact_kind": "document",
            "url": "https://example.com/briefing.pptx",
            "filename": "briefing.pptx",
            "mime_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        },
    ]


def test_build_task_artifacts_from_structured_outputs_accepts_prefixed_declared_ports() -> None:
    artifacts = _build_task_artifacts_from_structured_outputs(
        {
            "output_ports": [
                {"id": "out-summary", "artifact_kind": "text"},
            ]
        },
        [
            {
                "output_port_id": "summary",
                "artifact_kind": "text",
                "content": "Executive summary",
            },
        ],
        [],
    )

    assert artifacts == [
        {
            "port_id": "out-summary",
            "artifact_kind": "text",
            "content": "Executive summary",
        },
    ]


def test_build_task_artifacts_from_structured_outputs_routes_inline_data() -> None:
    artifacts = _build_task_artifacts_from_structured_outputs(
        {
            "output_ports": [
                {"id": "summary", "artifact_kind": "text"},
                {"id": "metrics", "artifact_kind": "data"},
            ]
        },
        [
            {
                "output_port_id": "summary",
                "artifact_kind": "text",
                "content": "Executive summary",
            },
            {
                "output_port_id": "metrics",
                "artifact_kind": "data",
                "content": {"score": 88, "status": "ok"},
            },
        ],
        [],
    )

    assert artifacts == [
        {
            "port_id": "summary",
            "artifact_kind": "text",
            "content": "Executive summary",
        },
        {
            "port_id": "metrics",
            "artifact_kind": "data",
            "data": {"score": 88, "status": "ok"},
        },
    ]


def test_build_task_artifacts_from_structured_outputs_uses_declared_document_kind() -> None:
    artifacts = _build_task_artifacts_from_structured_outputs(
        {
            "output_ports": [
                {"id": "default", "artifact_kind": "document"},
            ]
        },
        [
            {
                "output_port_id": "default",
                "artifact_kind": "data",
                "content": {"filename": "report.pdf"},
            },
        ],
        [
            {
                "file_path": "https://example.com/report.pdf",
                "filename": "report.pdf",
                "mime_type": "application/pdf",
            }
        ],
    )

    assert artifacts == [
        {
            "port_id": "default",
            "artifact_kind": "document",
            "url": "https://example.com/report.pdf",
            "filename": "report.pdf",
            "mime_type": "application/pdf",
        }
    ]


def test_build_task_artifacts_from_structured_outputs_uses_declared_data_kind() -> None:
    artifacts = _build_task_artifacts_from_structured_outputs(
        {
            "output_ports": [
                {"id": "default", "artifact_kind": "data"},
            ]
        },
        [
            {
                "output_port_id": "default",
                "artifact_kind": "document",
                "content": {"score": 88, "status": "ok"},
            },
        ],
        [],
    )

    assert artifacts == [
        {
            "port_id": "default",
            "artifact_kind": "data",
            "data": {"score": 88, "status": "ok"},
        }
    ]


def test_build_task_artifacts_from_structured_outputs_rejects_old_data_field() -> None:
    with pytest.raises(ValueError, match="must include content"):
        _build_task_artifacts_from_structured_outputs(
            {
                "output_ports": [
                    {"id": "metrics", "artifact_kind": "data"},
                ]
            },
            [
                {
                    "output_port_id": "metrics",
                    "artifact_kind": "data",
                    "data": {"score": 88, "status": "ok"},
                },
            ],
            [],
        )


def test_build_task_artifacts_from_structured_outputs_requires_artifact_kind() -> None:
    with pytest.raises(ValueError, match="must include artifact_kind"):
        _build_task_artifacts_from_structured_outputs(
            {
                "output_ports": [
                    {"id": "summary", "artifact_kind": "text"},
                ]
            },
            [
                {
                    "output_port_id": "summary",
                    "content": "Executive summary",
                },
            ],
            [],
        )


def test_build_task_artifacts_from_structured_outputs_skips_unknown_file_reference() -> None:
    artifacts = _build_task_artifacts_from_structured_outputs(
        {
            "output_ports": [
                {"id": "pdf", "artifact_kind": "document"},
            ]
        },
        [
            {
                "output_port_id": "pdf",
                "artifact_kind": "document",
                "content": {"filename": "missing-report.pdf"},
            },
        ],
        [
            {
                "file_path": "https://example.com/report.pdf",
                "filename": "report.pdf",
                "mime_type": "application/pdf",
            }
        ],
    )

    assert artifacts == []


def test_build_task_artifacts_from_structured_outputs_maps_generated_files_by_content_file_path() -> None:
    artifacts = _build_task_artifacts_from_structured_outputs(
        {
            "output_ports": [
                {"id": "pdf", "artifact_kind": "document"},
            ]
        },
        [
            {
                "output_port_id": "pdf",
                "artifact_kind": "document",
                "content": {"file_path": "https://example.com/report.pdf"},
            },
        ],
        [
            {
                "file_path": "https://example.com/report.pdf",
                "filename": "report.pdf",
                "mime_type": "application/pdf",
            }
        ],
    )

    assert artifacts == [
        {
            "port_id": "pdf",
            "artifact_kind": "document",
            "url": "https://example.com/report.pdf",
            "filename": "report.pdf",
            "mime_type": "application/pdf",
        }
    ]


def test_build_task_artifacts_preserves_generated_object_key() -> None:
    artifacts = _build_task_artifacts_from_structured_outputs(
        {
            "output_ports": [
                {"id": "report", "artifact_kind": "document"},
            ]
        },
        [
            {
                "output_port_id": "report",
                "artifact_kind": "document",
                "content": {"filename": "report.xlsx"},
            },
        ],
        [
            {
                "file_path": "https://example.com/report.xlsx",
                "object_key": "user/session/report.xlsx",
                "filename": "report.xlsx",
                "mime_type": (
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                ),
            }
        ],
    )

    assert artifacts == [
        {
            "port_id": "report",
            "artifact_kind": "document",
            "url": "https://example.com/report.xlsx",
            "object_key": "user/session/report.xlsx",
            "filename": "report.xlsx",
            "mime_type": (
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            ),
        }
    ]


def test_validate_declared_output_ports_accepts_declared_ids() -> None:
    _validate_declared_output_ports(
        {"declared_output_ports": ["summary", "context"]},
        [
            {"output_port_id": "summary", "artifact_kind": "text", "content": "ok"},
            {"output_port_id": "context", "artifact_kind": "text", "content": "ok"},
        ],
    )


def test_validate_declared_output_ports_rejects_undeclared_id() -> None:
    with pytest.raises(ValueError, match="undeclared output port"):
        _validate_declared_output_ports(
            {"declared_output_ports": ["summary"]},
            [{"output_port_id": "other", "artifact_kind": "text", "content": "bad"}],
        )


def test_validate_declared_output_ports_rejects_missing_id() -> None:
    with pytest.raises(ValueError, match="must include output_port_id"):
        _validate_declared_output_ports(
            {"declared_output_ports": ["summary"]},
            [{"artifact_kind": "text", "content": "bad"}],
        )


def test_validate_declared_output_ports_accepts_prefixed_and_unprefixed_ids() -> None:
    _validate_declared_output_ports(
        {"declared_output_ports": ["out-summary"]},
        [{"output_port_id": "summary", "artifact_kind": "text", "content": "ok"}],
    )


def test_validate_declared_output_ports_accepts_uuid_style_prefixed_ids() -> None:
    _validate_declared_output_ports(
        {"declared_output_ports": ["out-5eb055fa"]},
        [{"output_port_id": "5eb055fa", "artifact_kind": "text", "content": "ok"}],
    )


def test_parse_structured_final_response_requires_display_text() -> None:
    with pytest.raises(ValueError, match="display_text"):
        _parse_structured_final_response('{"outputs": []}')


def test_parse_structured_final_response_requires_outputs_list() -> None:
    with pytest.raises(ValueError, match="display_text and outputs"):
        _parse_structured_final_response('{"display_text": "Hello"}')


def test_parse_structured_final_response_accepts_outputs_dict() -> None:
    parsed = _parse_structured_final_response(
        '{"displayText": "Hello", "outputs": {"summary": {"artifactKind": "text", "content": "world"}}}'
    )

    assert parsed == {
        "display_text": "Hello",
        "outputs": [{"output_port_id": "summary", "artifactKind": "text", "content": "world"}],
    }


def test_parse_structured_final_response_accepts_legacy_ports_list() -> None:
    parsed = _parse_structured_final_response(
        '{"display_text": "Hello", "ports": [{"id": "summary", "artifact_kind": "text", "value": "world"}]}'
    )

    assert parsed == {
        "display_text": "Hello",
        "outputs": [{"id": "summary", "artifact_kind": "text", "value": "world", "content": "world"}],
    }


def test_parse_structured_final_response_recovers_reasoning_trace_from_outputs() -> None:
    parsed = _parse_structured_final_response(
        '{"display_text":"Hello","outputs":[{"output_port_id":"summary","artifact_kind":"text","content":"world"},{"id":"step_1","type":"observation","label":"Read","description":"Read the brief.","confidence":0.9}]}'
    )

    assert parsed == {
        "display_text": "Hello",
        "outputs": [{"output_port_id": "summary", "artifact_kind": "text", "content": "world"}],
        "reasoning_trace": [
            {
                "id": "step_1",
                "type": "observation",
                "label": "Read",
                "description": "Read the brief.",
                "confidence": 0.9,
            }
        ],
    }


def test_build_plain_text_artifact_maps_single_text_port() -> None:
    artifact = _build_plain_text_artifact(
        {"output_ports": [{"id": "out-summary", "artifact_kind": "text"}]},
        "  Executive summary  ",
    )

    assert artifact == {
        "port_id": "out-summary",
        "artifact_kind": "text",
        "content": "Executive summary",
    }


def test_collect_generated_artifacts_preserves_explicit_output_metadata() -> None:
    artifacts = _collect_generated_artifacts(
        [
            {
                "type": "artifact",
                "data": {
                    "file_path": "https://example.com/report.pdf",
                    "filename": "report.pdf",
                    "artifact_kind": "document",
                    "output_port_id": "report",
                    "mime_type": "application/pdf",
                },
            }
        ]
    )

    assert artifacts == [
        {
            "file_path": "https://example.com/report.pdf",
            "filename": "report.pdf",
            "artifact_kind": "document",
            "output_port_id": "report",
            "mime_type": "application/pdf",
        }
    ]


def test_finalize_task_outputs_parses_structured_final_response() -> None:
    response, artifacts = _finalize_task_outputs(
        {
            "output_ports": [
                {"id": "summary", "artifact_kind": "text"},
                {"id": "context", "artifact_kind": "text"},
            ],
            "declared_output_ports": ["summary", "context"],
        },
        '{"display_text": "User answer", "outputs": [{"output_port_id": "summary", "artifact_kind": "text", "content": "Short"}, {"output_port_id": "context", "artifact_kind": "text", "content": "Long"}]}',
        [],
        "structured_final_response",
    )

    assert response == "User answer"
    assert artifacts == [
        {"port_id": "summary", "artifact_kind": "text", "content": "Short"},
        {"port_id": "context", "artifact_kind": "text", "content": "Long"},
    ]


def test_finalize_task_outputs_parses_structured_text_and_data_outputs() -> None:
    response, artifacts = _finalize_task_outputs(
        {
            "output_ports": [
                {"id": "summary", "artifact_kind": "text"},
                {"id": "metrics", "artifact_kind": "data"},
            ],
            "declared_output_ports": ["summary", "metrics"],
        },
        '{"display_text": "Done", "outputs": [{"output_port_id": "summary", "artifact_kind": "text", "content": "Short"}, {"output_port_id": "metrics", "artifact_kind": "data", "content": {"score": 88, "status": "ok"}}]}',
        [],
        "structured_final_response",
    )

    assert response == "Done"
    assert artifacts == [
        {"port_id": "summary", "artifact_kind": "text", "content": "Short"},
        {
            "port_id": "metrics",
            "artifact_kind": "data",
            "data": {"score": 88, "status": "ok"},
        },
    ]


def test_finalize_task_outputs_parses_structured_file_outputs() -> None:
    response, artifacts = _finalize_task_outputs(
        {
            "output_ports": [
                {"id": "pdf", "artifact_kind": "document"},
                {"id": "slides", "artifact_kind": "document"},
            ],
            "declared_output_ports": ["pdf", "slides"],
        },
        '{"display_text": "Files ready", "outputs": [{"output_port_id": "pdf", "artifact_kind": "document", "content": {"filename": "report.pdf"}}, {"output_port_id": "slides", "artifact_kind": "document", "content": {"filename": "deck.pptx"}}]}',
        [
            {
                "type": "artifact",
                "data": {
                    "file_path": "https://example.com/report.pdf",
                    "filename": "report.pdf",
                    "artifact_kind": "document",
                    "mime_type": "application/pdf",
                },
            },
            {
                "type": "artifact",
                "data": {
                    "file_path": "https://example.com/deck.pptx",
                    "filename": "deck.pptx",
                    "artifact_kind": "document",
                    "mime_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                },
            },
        ],
        "structured_final_response",
    )

    assert response == "Files ready"
    assert artifacts == [
        {
            "port_id": "pdf",
            "artifact_kind": "document",
            "url": "https://example.com/report.pdf",
            "filename": "report.pdf",
            "mime_type": "application/pdf",
        },
        {
            "port_id": "slides",
            "artifact_kind": "document",
            "url": "https://example.com/deck.pptx",
            "filename": "deck.pptx",
            "mime_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        },
    ]


def test_attach_result_text_for_citations_appends_text_and_parents_citations() -> None:
    components = [
        {
            "type": "sources",
            "data": {"sources": [{"title": "Doc", "url": "https://example.com/doc"}]},
        },
        {
            "type": "citation",
            "data": {
                "parent_id": "",
                "text_source": {
                    "type": "text",
                    "source": "Doc",
                    "external_id": "ext-1",
                    "page": "2",
                    "page_content": "Important clause",
                    "workspace_id": "ws-1",
                    "reference": "1",
                },
            },
        },
    ]

    updated = _attach_result_text_for_citations(
        "Final answer with citation [1].",
        components,
    )

    assert [component["type"] for component in updated] == ["sources", "text", "citation"]
    assert updated[1]["data"]["content"] == "Final answer with citation [1]."
    assert updated[1]["id"].startswith("playbook-final-text-")
    assert updated[2]["data"]["parent_id"] == updated[1]["id"]


def test_attach_result_text_for_citations_reuses_existing_matching_text_component() -> None:
    components = [
        {
            "id": "final-text",
            "type": "text",
            "data": {"content": "Final answer with citation [1]."},
        },
        {
            "type": "citation",
            "data": {
                "parent_id": "",
                "text_source": {
                    "type": "text",
                    "source": "Doc",
                    "external_id": "ext-1",
                    "page": "2",
                    "page_content": "Important clause",
                    "workspace_id": "ws-1",
                    "reference": "1",
                },
            },
        },
    ]

    updated = _attach_result_text_for_citations(
        "Final answer with citation [1].",
        components,
    )

    assert len(updated) == 2
    assert updated[0]["id"] == "final-text"
    assert updated[1]["data"]["parent_id"] == "final-text"


def test_extract_json_object_returns_last_object_from_multi_json_response() -> None:
    # Model emitted tool-call metadata + structured response on separate lines
    raw = (
        '{"query":"site:example.com SIEM EDR"}\n'
        '{"display_text":"No data","outputs":[{"output_port_id":"alerts_batch","artifact_kind":"data","content":{"alerts":[]}}]}'
    )
    result = _extract_json_object(raw)
    assert result["display_text"] == "No data"
    assert len(result["outputs"]) == 1
    assert result["outputs"][0]["output_port_id"] == "alerts_batch"


def test_extract_json_object_handles_single_object() -> None:
    result = _extract_json_object('{"key": "value"}')
    assert result == {"key": "value"}


def test_extract_json_object_raises_on_no_json() -> None:
    with pytest.raises(ValueError, match="did not return a JSON object"):
        _extract_json_object("no json here")


def test_parse_structured_final_response_skips_trailing_json_metadata() -> None:
    raw = (
        '{"display_text":"Rapport DOCX","outputs":[{"output_port_id":"output-document","artifact_kind":"document","content":"test"}]}\n'
        '\nDone: {"status":"ok"}'
    )
    result = _parse_structured_final_response(raw)
    assert result["display_text"] == "Rapport DOCX"


def test_parse_structured_final_response_skips_leading_json_in_thinking() -> None:
    raw = (
        '<thinking>The tool returned {"filename":"report.docx"} successfully.</thinking>\n'
        '{"display_text":"Report ready","outputs":[{"output_port_id":"out","artifact_kind":"text","content":"done"}]}'
    )
    result = _parse_structured_final_response(raw)
    assert result["display_text"] == "Report ready"
