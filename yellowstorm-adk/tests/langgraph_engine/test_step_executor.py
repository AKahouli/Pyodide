import asyncio
import sys
from types import SimpleNamespace

import pytest

from src.langgraph_engine.step_executor import (
    _execute_with_tools,
    _attach_result_text_for_citations,
    _build_plain_file_artifacts,
    _build_plain_text_artifact,
    _build_task_artifacts_from_structured_outputs,
    _determine_output_mode,
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


def test_task_requires_structured_output_synthesis_for_duplicate_kinds() -> None:
    assert _task_requires_structured_output_synthesis(
        {
            "output_ports": [
                {"id": "summary", "artifact_kind": "text"},
                {"id": "context", "artifact_kind": "text"},
            ]
        }
    ) is True

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


def test_determine_output_mode_uses_structured_for_duplicate_text_ports() -> None:
    assert _determine_output_mode(
        {
            "output_ports": [
                {"id": "summary", "artifact_kind": "text"},
                {"id": "context", "artifact_kind": "text"},
            ]
        }
    ) == "structured_final_response"


def test_determine_output_mode_uses_structured_for_duplicate_document_ports() -> None:
    assert _determine_output_mode(
        {
            "output_ports": [
                {"id": "pdf", "artifact_kind": "document"},
                {"id": "slides", "artifact_kind": "document"},
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
                "filename": "client-report.pdf",
            },
            {
                "output_port_id": "slides",
                "artifact_kind": "document",
                "filename": "briefing.pptx",
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
    with pytest.raises(ValueError, match="outputs list"):
        _parse_structured_final_response('{"display_text": "Hello"}')


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


def test_build_plain_file_artifacts_maps_single_generated_file() -> None:
    artifacts = _build_plain_file_artifacts(
        {"output_ports": [{"id": "report", "artifact_kind": "document"}]},
        [
            {
                "file_path": "https://example.com/report.pdf",
                "filename": "report.pdf",
                "artifact_kind": "document",
                "mime_type": "application/pdf",
            }
        ],
    )

    assert artifacts == [
        {
            "port_id": "report",
            "artifact_kind": "document",
            "url": "https://example.com/report.pdf",
            "filename": "report.pdf",
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


def test_finalize_task_outputs_parses_structured_file_outputs() -> None:
    response, artifacts = _finalize_task_outputs(
        {
            "output_ports": [
                {"id": "pdf", "artifact_kind": "document"},
                {"id": "slides", "artifact_kind": "document"},
            ],
            "declared_output_ports": ["pdf", "slides"],
        },
        '{"display_text": "Files ready", "outputs": [{"output_port_id": "pdf", "artifact_kind": "document", "filename": "report.pdf"}, {"output_port_id": "slides", "artifact_kind": "document", "filename": "deck.pptx"}]}',
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
