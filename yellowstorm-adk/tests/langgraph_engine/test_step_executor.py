import pytest

from src.langgraph_engine.step_executor import (
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
