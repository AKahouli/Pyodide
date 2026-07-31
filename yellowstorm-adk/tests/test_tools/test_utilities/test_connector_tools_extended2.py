"""Extended connector_tools coverage for schema, workspace binding, and import."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.smart_rag.tools.utilities.connector_tools import (
    _build_connector_import_url,
    _build_function_schema,
    _build_image_reference_labels,
    _build_signature,
    _buffer_mcp_images_for_model,
    _is_workspace_placeholder,
    _needs_workspace_binding,
    _relax_bound_workspace_requirements,
    _relax_fixed_param_requirements,
    _resolve_default_workspace_id,
    _schema_type_to_adk_property,
    _schema_type_to_python_annotation,
    _strip_mcp_content_parts,
    _unique_strings,
    _with_default_workspace_params,
    _with_tool_context_signature,
    create_save_file_to_workspace,
    import_connector_items_to_workspace_request,
)


class TestConnectorSchemaHelpers:
    def test_schema_type_to_adk_property_with_items(self):
        prop = _schema_type_to_adk_property(
            {
                "type": ["null", "array"],
                "description": "tags",
                "items": {"type": "string", "enum": ["a", "b"]},
            }
        )
        assert prop["type"] == "array"
        assert prop["items"]["enum"] == ["a", "b"]

    def test_build_function_schema_defaults_params_object(self):
        schema = _build_function_schema("read_doc", "Read a document", {})
        assert schema["function"]["name"] == "read_doc"
        assert "params" in schema["function"]["parameters"]["properties"]

    def test_build_function_schema_with_properties(self):
        schema = _build_function_schema(
            "search",
            "Search docs",
            {
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        )
        assert schema["function"]["parameters"]["required"] == ["query"]

    def test_schema_type_to_python_annotation_types(self):
        assert _schema_type_to_python_annotation({"type": "integer"})
        assert _schema_type_to_python_annotation({"type": "boolean"})
        assert _schema_type_to_python_annotation({"type": "object"})

    def test_build_signature_empty_and_with_properties(self):
        empty = _build_signature({})
        assert "params" in empty.parameters

        signature = _build_signature(
            {
                "properties": {
                    "query": {"type": "string"},
                    "limit": {"type": "integer", "default": 5},
                },
                "required": ["query"],
            }
        )
        assert signature.parameters["query"].default is signature.parameters["query"].empty
        assert signature.parameters["limit"].default == 5

    def test_with_tool_context_signature_appends_context(self):
        base = _build_signature({"properties": {"query": {"type": "string"}}, "required": []})
        extended = _with_tool_context_signature(base)
        assert "tool_context" in extended.parameters


class TestConnectorWorkspaceBinding:
    def test_workspace_placeholder_and_binding(self):
        assert _is_workspace_placeholder("default") is True
        assert _needs_workspace_binding("") is True
        assert _needs_workspace_binding("workspace-1") is False

    def test_resolve_default_workspace_id(self):
        assert _resolve_default_workspace_id(["w1", "w2"], None) == "w1"
        assert _resolve_default_workspace_id([], "explicit") == "explicit"

    def test_relax_bound_workspace_requirements(self):
        schema = {
            "properties": {"workspace_id": {"type": "string"}, "query": {"type": "string"}},
            "required": ["workspace_id", "query"],
        }
        relaxed = _relax_bound_workspace_requirements(schema, "w1")
        assert relaxed["required"] == ["query"]

    def test_relax_fixed_param_requirements(self):
        schema = {
            "properties": {"mode": {"type": "string"}, "query": {"type": "string"}},
            "required": ["mode", "query"],
        }
        relaxed = _relax_fixed_param_requirements(schema, {"mode": "file"})
        assert relaxed["required"] == ["query"]

    def test_with_default_workspace_params_injects_ids(self):
        params = _with_default_workspace_params(
            {},
            {
                "properties": {
                    "workspace_id": {"type": "string"},
                    "workspace_ids": {"type": "array"},
                }
            },
            ["w1", "w2"],
            "w1",
        )
        assert params["workspace_id"] == "w1"
        assert params["workspace_ids"] == ["w1", "w2"]

    def test_unique_strings_dedupes(self):
        assert _unique_strings(["a", "a", "", "b", "b"]) == ["a", "b"]


class TestConnectorMcpAndImport:
    def test_strip_mcp_content_parts(self):
        stripped = _strip_mcp_content_parts({"text": "ok", "__mcp_content_parts": []})
        assert stripped == {"text": "ok"}

    def test_build_image_reference_labels(self):
        labels = _build_image_reference_labels(
            {"images": [{"image_id": "img-1", "image_content_index": "0"}]}
        )
        assert "image_id=img-1" in labels[0]

    def test_buffer_mcp_images_for_model(self):
        tool_context = SimpleNamespace(state={})
        response = {
            "text": "see image",
            "__mcp_content_parts": [
                {"type": "text", "text": "caption"},
                {"type": "image", "data": "abc", "mimeType": "image/png"},
            ],
        }
        result = _buffer_mcp_images_for_model(response, tool_context)
        assert "mcp_content_parts" not in result
        assert any(key.startswith("_pending_tool_images_") for key in tool_context.state)

    def test_build_connector_import_url_variants(self):
        assert _build_connector_import_url("https://api.example.com/api/v1").endswith(
            "/connectors/transfer/import"
        )
        assert "/api/v1/connectors/transfer/import" in _build_connector_import_url(
            "https://api.example.com"
        )

    def test_import_connector_items_validation_errors(self):
        assert "mode must be" in import_connector_items_to_workspace_request(
            backend_url="http://localhost",
            connector_id="c1",
            connector_name="SharePoint",
            workspace_id="w1",
            auth_headers={},
            mode="invalid",
        )
        assert "could not extract driveId" in import_connector_items_to_workspace_request(
            backend_url="http://localhost",
            connector_id="c1",
            connector_name="SharePoint",
            workspace_id="w1",
            auth_headers={},
            mode="file",
            item_ref={"bad": "shape"},
        )

    @patch("src.smart_rag.tools.utilities.connector_tools.requests.post")
    @patch("src.smart_rag.tools.utilities.connector_tools._get_platform_access_token")
    def test_import_connector_items_success(self, mock_token, mock_post):
        mock_token.return_value = "token"
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "data": {
                "summary": {"requested": 1, "imported": 1, "failed": 0},
                "imported": [
                    {"success": True, "finalFilename": "doc.pdf", "workspaceDocumentId": "d1"}
                ],
                "errors": [],
            }
        }
        mock_post.return_value = mock_response
        result = import_connector_items_to_workspace_request(
            backend_url="http://localhost/api/v1",
            connector_id="c1",
            connector_name="SharePoint",
            workspace_id="w1",
            auth_headers={},
            mode="file",
            item_ref={"driveId": "d", "itemId": "i"},
        )
        assert "Imported connector items" in result
        assert "doc.pdf" in result


class TestSaveFileToWorkspace:
    @pytest.mark.asyncio
    async def test_posts_ingest_request_and_propagates_brain_doc(self):
        response = MagicMock(status_code=200)
        response.json.return_value = {
            "document": {
                "id": "doc-1",
                "originalName": "report.xlsx",
                "size": 123,
                "filePath": "workspace/report.xlsx",
            }
        }
        client = AsyncMock()
        client.post.return_value = response
        client_context = MagicMock()
        client_context.__aenter__ = AsyncMock(return_value=client)
        client_context.__aexit__ = AsyncMock(return_value=None)
        tool_context = SimpleNamespace(state={})
        tool = create_save_file_to_workspace(
            {
                "platform_api_url": "https://platform.example.com/api/v1",
                "platform_api_token": "internal-secret",
                "user_id": "user-1",
            }
        )

        with patch("httpx.AsyncClient", return_value=client_context):
            result = await tool(
                download_url="https://files.example.com/report.xlsx",
                workspace_id="workspace-1",
                filename="report.xlsx",
                mime_type="application/vnd.ms-excel",
                auth_headers={"Authorization": "Bearer source-token"},
                source_meta={"connector": "SharePoint"},
                tool_context=tool_context,
            )

        assert "File saved to workspace successfully" in result
        client.post.assert_awaited_once_with(
            "https://platform.example.com/api/v1/workspaces/workspace-1/documents/ingest-url",
            json={
                "downloadUrl": "https://files.example.com/report.xlsx",
                "filename": "report.xlsx",
                "userId": "user-1",
                "mimeType": "application/vnd.ms-excel",
                "authHeaders": {"Authorization": "Bearer source-token"},
                "sourceMeta": {"connector": "SharePoint"},
            },
            headers={
                "X-Internal-Token": "internal-secret",
                "Content-Type": "application/json",
            },
        )
        assert tool_context.state["_code_interpreter_brain_docs"] == [
            {
                "filename": "report.xlsx",
                "filepath": "workspace/report.xlsx",
                "workspace_id": "workspace-1",
            }
        ]

    def test_requires_platform_credentials(self):
        assert create_save_file_to_workspace({}) is None
        assert create_save_file_to_workspace({"platform_api_url": "https://example.com"}) is None

    @pytest.mark.asyncio
    async def test_redacts_runtime_context_from_failures(self):
        tool = create_save_file_to_workspace(
            {
                "platform_api_url": "https://platform.example.com",
                "platform_api_token": "internal-secret",
                "user_id": "user-1",
            }
        )
        client_context = MagicMock()
        client_context.__aenter__ = AsyncMock(
            side_effect=RuntimeError(
                "internal-secret https://platform.example.com user-1"
            )
        )
        client_context.__aexit__ = AsyncMock(return_value=None)

        with patch("httpx.AsyncClient", return_value=client_context), patch(
            "src.smart_rag.tools.utilities.connector_tools.logger.error"
        ) as log_error:
            result = await tool(
                download_url="https://files.example.com/report.xlsx",
                workspace_id="workspace-1",
                filename="report.xlsx",
            )

        assert "internal-secret" not in result
        assert "https://platform.example.com" not in result
        assert "user-1" not in result
        assert log_error.call_args.args[1] == "[REDACTED] [REDACTED] [REDACTED]"
