from src.flow_engine.nodes.step_tool_scope import (
    build_prompt_input_context,
    build_sandbox_prompt_note,
    build_step_tool_scope,
)


def test_build_step_tool_scope_prefers_display_name_for_mounted_filename() -> None:
    scope = build_step_tool_scope(
        {
            "default": {
                "workspaceId": "workspace-1",
                "path": "user/workspace/doc-1/CV_Kevin_Diallo.pdf",
                "kind": "document",
                "id": "doc-1",
                "metadata": {
                    "documentId": "doc-1",
                    "workspaceId": "workspace-1",
                    "filepath": "user/workspace/doc-1/CV_Kevin_Diallo.pdf",
                    "filename": "doc-1-CV_Kevin_Diallo.pdf",
                },
                "name": "CV_Kevin_Diallo.pdf",
            }
        },
        {},
    )

    assert scope.file_names == ["doc-1-CV_Kevin_Diallo.pdf"]
    assert scope.documents_by_port == {"default": ["doc-1-CV_Kevin_Diallo.pdf"]}
    assert scope.code_interpreter_files == [
        {
            "document_id": "doc-1",
            "filename": "CV_Kevin_Diallo.pdf",
            "file_name": "doc-1-CV_Kevin_Diallo.pdf",
            "filepath": "user/workspace/doc-1/CV_Kevin_Diallo.pdf",
            "workspace_id": "workspace-1",
            "workspace_name": "workspace-1",
            "workspace_path": "user/workspace/doc-1",
            "kind": "document",
        }
    ]
    assert scope.mounted_filenames == ["CV_Kevin_Diallo.pdf"]
    assert scope.workspace_context_mode == "resolved_inputs_only"


def test_build_step_tool_scope_normalizes_brain_context_fallback() -> None:
    scope = build_step_tool_scope(
        {},
        {
            "brain_context": [
                {
                    "workspace_id": "workspace-1",
                    "workspace_documents": [
                        {
                            "_id": "doc-1",
                            "filename": "report.pdf",
                            "filepath": "user/workspace/doc-1/report.pdf",
                        }
                    ],
                }
            ]
        },
    )

    assert scope.workspace_context_mode == "fallback_playbook"
    assert scope.workspace_context == [
        {
            "workspace_id": "workspace-1",
            "workspace_name": "workspace-1",
            "documents": [
                {
                    "id": "doc-1",
                    "_id": "doc-1",
                    "filename": "report.pdf",
                    "file_name": "report.pdf",
                    "filepath": "user/workspace/doc-1/report.pdf",
                    "workspace_id": "workspace-1",
                    "workspace_name": "workspace-1",
                }
            ],
        }
    ]


def test_build_sandbox_prompt_note_warns_against_storage_names() -> None:
    scope = build_step_tool_scope(
        {
            "default": {
                "name": "CV_Kevin_Diallo.pdf",
                "path": "user/workspace/doc-1/CV_Kevin_Diallo.pdf",
            }
        },
        {},
    )

    note = build_sandbox_prompt_note(scope, {"code interpreter"})

    assert "CV_Kevin_Diallo.pdf" in note
    assert "metadata storage filenames" in note


def test_build_prompt_input_context_rewrites_storage_filename_for_prompt() -> None:
    prompt_context = build_prompt_input_context(
        {
            "default": {
                "name": "CV_Kevin_Diallo.pdf",
                "path": "user/workspace/doc-1/CV_Kevin_Diallo.pdf",
                "metadata": {
                    "filename": "doc-1-CV_Kevin_Diallo.pdf",
                },
            }
        }
    )

    assert prompt_context["default"]["metadata"]["filename"] == "CV_Kevin_Diallo.pdf"


def test_build_step_tool_scope_preserves_opaque_document_refs() -> None:
    scope = build_step_tool_scope(
        {"report": {"document_id": "doc-1", "filename": "report.xlsx"}},
        {
            "brain_context": [
                {
                    "workspace_id": "workspace-1",
                    "workspace_documents": [
                        {
                            "_id": "doc-1",
                            "filename": "report.xlsx",
                            "filepath": "user/workspace/doc-1/report.xlsx",
                        }
                    ],
                }
            ]
        },
    )

    assert scope.file_names == ["report.xlsx"]
    assert scope.documents_by_port == {"report": ["report.xlsx"]}
    assert scope.code_interpreter_files == [
        {
            "document_id": "doc-1",
            "filename": "report.xlsx",
            "file_name": "report.xlsx",
            "filepath": "user/workspace/doc-1/report.xlsx",
            "workspace_id": "workspace-1",
            "workspace_name": "workspace-1",
            "workspace_path": "user/workspace/doc-1",
        }
    ]
    assert scope.workspace_context == []
    assert scope.workspace_context_mode == "resolved_inputs_only"


def test_build_step_tool_scope_keeps_opaque_refs_without_fallback_workspace() -> None:
    scope = build_step_tool_scope(
        {"report": {"document_id": "doc-2", "filename": "generated-report.xlsx"}},
        {
            "brain_context": [
                {
                    "workspace_id": "workspace-1",
                    "workspace_documents": [
                        {
                            "_id": "doc-1",
                            "filename": "report.xlsx",
                            "filepath": "user/workspace/doc-1/report.xlsx",
                        }
                    ],
                }
            ]
        },
    )

    assert scope.file_names == ["generated-report.xlsx"]
    assert scope.documents_by_port == {"report": ["generated-report.xlsx"]}
    assert scope.code_interpreter_files == []
    assert scope.workspace_context == []
    assert scope.workspace_context_mode == "resolved_inputs_only"


def test_build_step_tool_scope_prefers_workspace_filename_when_hydrating() -> None:
    scope = build_step_tool_scope(
        {"report": {"document_id": "doc-1", "filename": "doc-1-report.xlsx"}},
        {
            "brain_context": [
                {
                    "workspace_id": "workspace-1",
                    "workspace_documents": [
                        {
                            "_id": "doc-1",
                            "filename": "report.xlsx",
                            "filepath": "user/workspace/doc-1/report.xlsx",
                        }
                    ],
                }
            ]
        },
    )

    assert scope.code_interpreter_files == [
        {
            "document_id": "doc-1",
            "filename": "report.xlsx",
            "file_name": "report.xlsx",
            "filepath": "user/workspace/doc-1/report.xlsx",
            "workspace_id": "workspace-1",
            "workspace_name": "workspace-1",
            "workspace_path": "user/workspace/doc-1",
        }
    ]


def test_build_step_tool_scope_resolves_bound_file_id_to_search_filename() -> None:
    scope = build_step_tool_scope(
        {
            "report": {
                "document_id": "6a315401d7d4c01f4ab2e63c",
                "file_name": "6a315401d7d4c01f4ab2e63c",
            }
        },
        {
            "brain_context": [
                {
                    "workspace_id": "6a314fdad7d4c01f4ab2d25d",
                    "workspace_name": "testeval2",
                    "workspace_documents": [
                        {
                            "_id": "6a315401d7d4c01f4ab2e63c",
                            "filename": "02-annexe-1-cahier-des-charges-techniques.md",
                            "filepath": "6992fc709968567dc766a12d/testeval2/02-annexe-1-cahier-des-charges-techniques.md",
                            "file_name": "02-annexe-1-cahier-des-charges-techniques.md",
                            "workspace_id": "6a314fdad7d4c01f4ab2d25d",
                            "workspace_name": "testeval2",
                        }
                    ],
                }
            ]
        },
    )

    assert scope.file_names == ["02-annexe-1-cahier-des-charges-techniques.md"]
    assert scope.documents_by_port == {
        "report": ["02-annexe-1-cahier-des-charges-techniques.md"]
    }
