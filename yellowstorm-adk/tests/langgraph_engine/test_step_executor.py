from src.langgraph_engine.step_executor import (
    _attach_result_text_for_citations,
    _build_task_artifacts_from_structured_outputs,
    _task_requires_structured_output_synthesis,
    _validate_declared_output_ports,
)

import pytest


def test_task_requires_structured_output_synthesis_for_duplicate_kinds() -> None:
    assert _task_requires_structured_output_synthesis({
        "output_ports": [
            {"id": "summary", "artifact_kind": "text"},
            {"id": "context", "artifact_kind": "text"},
        ]
    }) is True

    assert _task_requires_structured_output_synthesis({
        "output_ports": [
            {"id": "pdf", "artifact_kind": "document"},
            {"id": "ppt", "artifact_kind": "document"},
        ]
    }) is False


def test_build_task_artifacts_from_structured_outputs_routes_multiple_text_ports() -> None:
    artifacts = _build_task_artifacts_from_structured_outputs(
        {
            "output_ports": [
                {"id": "summary", "artifact_kind": "text"},
                {"id": "context", "artifact_kind": "text"},
            ]
        },
        [
            {"output_port_id": "summary", "artifact_kind": "text", "content": "Executive summary"},
            {"output_port_id": "context", "artifact_kind": "text", "content": "Detailed context"},
        ],
        [],
    )

    assert artifacts == [
        {"port_id": "summary", "artifact_kind": "text", "content": "Executive summary"},
        {"port_id": "context", "artifact_kind": "text", "content": "Detailed context"},
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
            {"output_port_id": "client_pdf", "artifact_kind": "document", "filename": "client-report.pdf"},
            {"output_port_id": "slides", "artifact_kind": "document", "filename": "briefing.pptx"},
        ],
        [
            {"file_path": "https://example.com/client-report.pdf", "filename": "client-report.pdf", "mime_type": "application/pdf"},
            {"file_path": "https://example.com/briefing.pptx", "filename": "briefing.pptx", "mime_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation"},
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


<<<<<<< HEAD
def test_build_task_artifacts_from_structured_outputs_accepts_prefixed_declared_ports() -> None:
    artifacts = _build_task_artifacts_from_structured_outputs(
        {
            "output_ports": [
                {"id": "out-summary", "artifact_kind": "text"},
            ]
        },
        [
            {"output_port_id": "summary", "artifact_kind": "text", "content": "Executive summary"},
        ],
        [],
    )

    assert artifacts == [
        {"port_id": "out-summary", "artifact_kind": "text", "content": "Executive summary"},
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
=======
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
>>>>>>> 8a4e37d665fffbe4c99e77caa8ca334865c7e98a
