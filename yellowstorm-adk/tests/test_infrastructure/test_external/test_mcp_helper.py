"""Tests for MCP Helper."""

import pytest
from unittest.mock import MagicMock, patch, AsyncMock

from google.genai import types
from google.adk.tools.mcp_tool.mcp_tool import McpTool
from mcp.types import Tool

from src.smart_rag.infrastructure.external.mcp_helper import MCPHelper
from src.smart_rag.infrastructure.external.purpose_aware_mcp import (
    DISPLAY_PURPOSE_KEY,
    PurposeAwareMcpTool,
    PurposeAwareMcpToolset,
)


class TestMCPHelper:
    """Test cases for MCPHelper."""

    def test_init(self):
        """Test MCP helper initialization."""
        helper = MCPHelper()
        assert helper is not None

    def test_create_mcp_context_headers_uses_workspace_id(self):
        result = MCPHelper.create_mcp_context_headers(
            user_id="user123",
            file_names=["contract.pdf"],
            workspace_ids=["workspace-1"],
        )

        assert result == {
            "user_id": "user123",
            "file_name": "contract.pdf",
            "workspace_id": "workspace-1",
            "Workspace-Id": "workspace-1",
        }

    def test_create_mcp_context_headers_uses_workspace_id_for_legacy_names(self):
        result = MCPHelper.create_mcp_context_headers(
            user_id="user123",
            workspace_names=["workspace-1", "workspace-2"],
        )

        assert result == {
            "user_id": "user123",
            "workspace_id": '["workspace-1", "workspace-2"]',
            "Workspace-Id": "workspace-1,workspace-2",
        }

    def test_extract_minimal_fields(self):
        """Test extracting minimal fields from documents."""
        # extract_minimal_fields now extracts filepath, filename, _id and requires filepath
        documents = [
            {"filepath": "/path/test.txt", "filename": "test.txt", "_id": "doc1", "extra": "ignored", "content": "test"},
            {"filepath": "/path/test2.txt", "filename": "test2.txt", "_id": "doc2", "size": 1024}
        ]

        result = MCPHelper.extract_minimal_fields(documents)

        expected = [
            {"filepath": "/path/test.txt", "filename": "test.txt", "_id": "doc1"},
            {"filepath": "/path/test2.txt", "filename": "test2.txt", "_id": "doc2"}
        ]
        assert result == expected

    def test_extract_minimal_fields_missing_fields(self):
        """Test extracting minimal fields when some fields are missing."""
        documents = [
            {"filepath": "/path/test.txt", "filename": "test.txt"},  # Missing _id but has filepath
            {"_id": "doc2", "extra": "data"}  # Missing filepath - should be excluded
        ]

        result = MCPHelper.extract_minimal_fields(documents)

        # Only the first document should be included (has filepath)
        # The second document has no filepath so it's excluded
        expected = [
            {"filepath": "/path/test.txt", "filename": "test.txt"}
        ]
        assert result == expected

    @patch('src.smart_rag.infrastructure.external.mcp_helper.app_settings')
    def test_create_mcp_config_microsandbox(self, mock_settings):
        """Test creating Microsandbox MCP configuration."""
        mock_settings.MICROSANDBOX_MCP_URL = "https://localhost:8081"

        with patch('src.smart_rag.infrastructure.external.mcp_helper.StreamableHTTPConnectionParams') as mock_stream_params:
            mock_params = MagicMock()
            mock_stream_params.return_value = mock_params

            result = MCPHelper.create_mcp_config('microsandbox')

            mock_stream_params.assert_called_once_with(url="https://localhost:8081")
            assert result == mock_params

    def test_create_mcp_config_streamable_http_merges_auth_headers(self):
        with patch('src.smart_rag.infrastructure.external.mcp_helper.StreamableHTTPConnectionParams') as mock_stream_params:
            mock_params = MagicMock()
            mock_stream_params.return_value = mock_params

            result = MCPHelper.create_mcp_config(
                'mcp',
                transport_type='streamable_http',
                url='http://localhost:8045/http',
                user_id='user-1',
                workspace_ids=['workspace-1'],
                auth_headers={'X-User-Id': 'user-1'},
            )

            mock_stream_params.assert_called_once_with(
                url='http://localhost:8045/http',
                headers={
                    'user_id': 'user-1',
                    'workspace_id': 'workspace-1',
                    'Workspace-Id': 'workspace-1',
                    'X-User-Id': 'user-1',
                },
            )
            assert result == mock_params

    def test_create_mcp_config_unsupported_type(self):
        """Test creating MCP config with unsupported type."""
        with pytest.raises(ValueError, match="Unsupported MCP type: unknown"):
            MCPHelper.create_mcp_config('unknown')

    def test_streamable_http_connection_params_real_adk_api(self):
        """Streamable HTTP params must construct against the installed Google ADK API."""
        from google.adk.tools.mcp_tool.mcp_toolset import StreamableHTTPConnectionParams

        params = StreamableHTTPConnectionParams(
            url="https://vectorstore.example.com/mcp",
            headers={"X-Brain-ID": "brain-1"},
            timeout=180.0,
        )

        assert params.url == "https://vectorstore.example.com/mcp"
        assert params.headers == {"X-Brain-ID": "brain-1"}

    def test_create_mcp_toolset_success(self):
        """Test creating MCP toolset successfully."""
        connection_params = MagicMock()

        with patch('src.smart_rag.infrastructure.external.mcp_helper.PurposeAwareMcpToolset') as mock_toolset_class:
            mock_toolset = MagicMock()
            mock_toolset_class.return_value = mock_toolset

            result = MCPHelper.create_mcp_toolset(connection_params, 'vectorstore')

            mock_toolset_class.assert_called_once_with(connection_params=connection_params)
            assert result == mock_toolset
            assert result.mcp_type == 'vectorstore'

    def test_create_mcp_toolset_default_type(self):
        """Test creating MCP toolset with default type."""
        connection_params = MagicMock()

        with patch('src.smart_rag.infrastructure.external.mcp_helper.PurposeAwareMcpToolset') as mock_toolset_class:
            mock_toolset = MagicMock()
            mock_toolset_class.return_value = mock_toolset

            result = MCPHelper.create_mcp_toolset(connection_params)

            mock_toolset_class.assert_called_once_with(connection_params=connection_params)
            assert result == mock_toolset
            assert result.mcp_type == 'unknown'

    def test_create_mcp_toolset_import_error(self):
        """Test creating MCP toolset with import error."""
        connection_params = MagicMock()

        with patch('src.smart_rag.infrastructure.external.mcp_helper.PurposeAwareMcpToolset', side_effect=ImportError("Module not found")):
            with pytest.raises(ImportError):
                MCPHelper.create_mcp_toolset(connection_params)

    @pytest.mark.asyncio
    async def test_purpose_aware_tool_declares_metadata_but_strips_it_from_execution(self):
        raw_tool = MagicMock()
        raw_tool.inputSchema = {
            "type": "object",
            "properties": {"command": {"type": "string"}},
            "required": ["command"],
            "additionalProperties": False,
        }
        wrapped = MagicMock()
        wrapped.name = "shell_exec"
        wrapped.description = "Execute a command"
        wrapped.raw_mcp_tool = raw_tool
        wrapped._mcp_session_manager = MagicMock()
        wrapped._get_declaration.return_value = types.FunctionDeclaration(
            name="shell_exec",
            description="Execute a command",
            parameters_json_schema=raw_tool.inputSchema,
        )
        wrapped.run_async = AsyncMock(return_value={"ok": True})
        tool = PurposeAwareMcpTool(wrapped)

        declaration = tool._get_declaration()
        original_args = {
            "command": "printf safe",
            DISPLAY_PURPOSE_KEY: "Generate the report",
        }
        result = await tool.run_async(args=original_args, tool_context=MagicMock())

        assert DISPLAY_PURPOSE_KEY in declaration.parameters_json_schema["properties"]
        assert declaration.parameters_json_schema["required"] == [
            "command",
            DISPLAY_PURPOSE_KEY,
        ]
        assert declaration.parameters_json_schema["additionalProperties"] is False
        assert DISPLAY_PURPOSE_KEY not in raw_tool.inputSchema["properties"]
        assert original_args[DISPLAY_PURPOSE_KEY] == "Generate the report"
        assert result == {"ok": True}
        assert wrapped.run_async.await_args.kwargs["args"] == {"command": "printf safe"}

    def test_purpose_aware_real_mcp_tool_exposes_model_facing_purpose(self):
        wrapped = McpTool(
            mcp_tool=Tool(
                name="code-interpreter_file_list",
                description="List files",
                inputSchema={
                    "type": "object",
                    "properties": {"path": {"type": "string"}},
                    "required": ["path"],
                },
            ),
            mcp_session_manager=MagicMock(),
        )

        declaration = PurposeAwareMcpTool(wrapped)._get_declaration()

        assert DISPLAY_PURPOSE_KEY == "display_purpose"
        assert declaration.parameters_json_schema["required"] == ["path", DISPLAY_PURPOSE_KEY]
        assert declaration.parameters_json_schema["properties"][DISPLAY_PURPOSE_KEY]["type"] == "string"
        assert DISPLAY_PURPOSE_KEY not in wrapped.raw_mcp_tool.inputSchema["properties"]

    def test_purpose_aware_tool_supports_gemini_schema_declarations(self):
        wrapped = MagicMock()
        wrapped.name = "shell_exec"
        wrapped.description = "Execute a command"
        wrapped._get_declaration.return_value = types.FunctionDeclaration(
            name="shell_exec",
            description="Execute a command",
            parameters=types.Schema(
                type=types.Type.OBJECT,
                properties={"command": types.Schema(type=types.Type.STRING)},
                required=["command"],
            ),
        )

        declaration = PurposeAwareMcpTool(wrapped)._get_declaration()

        assert DISPLAY_PURPOSE_KEY in declaration.parameters.properties
        assert declaration.parameters.required == ["command", DISPLAY_PURPOSE_KEY]

    @pytest.mark.asyncio
    async def test_purpose_aware_tool_preserves_adk_confirmation_gate(self):
        session_manager = MagicMock()
        wrapped = McpTool(
            mcp_tool=Tool(
                name="shell_exec",
                description="Execute a command",
                inputSchema={
                    "type": "object",
                    "properties": {"command": {"type": "string"}},
                    "required": ["command"],
                },
            ),
            mcp_session_manager=session_manager,
            require_confirmation=True,
        )
        tool_context = MagicMock()
        tool_context.tool_confirmation = None

        result = await PurposeAwareMcpTool(wrapped).run_async(
            args={
                "command": "printf safe",
                DISPLAY_PURPOSE_KEY: "Generate the report",
            },
            tool_context=tool_context,
        )

        assert "requires confirmation" in result["error"]
        tool_context.request_confirmation.assert_called_once()
        session_manager.create_session.assert_not_called()

    @pytest.mark.asyncio
    async def test_purpose_aware_toolset_preserves_server_field_collision(self):
        colliding = MagicMock()
        colliding.name = "server_owned"
        colliding.raw_mcp_tool.inputSchema = {
            "type": "object",
            "properties": {DISPLAY_PURPOSE_KEY: {"type": "number"}},
        }
        normal = MagicMock()
        normal.name = "normal"
        normal.description = "Normal tool"
        normal.raw_mcp_tool.inputSchema = {"type": "object", "properties": {}}

        with patch.object(
            PurposeAwareMcpToolset.__mro__[1],
            "get_tools",
            new=AsyncMock(return_value=[colliding, normal]),
        ):
            toolset = object.__new__(PurposeAwareMcpToolset)
            tools = await toolset.get_tools()

        assert tools[0] is colliding
        assert isinstance(tools[1], PurposeAwareMcpTool)

    def test_create_toolsets_success(self):
        """Test creating multiple toolsets successfully."""
        mcp_configs = [
            {'type': 'vectorstore', 'headers': {'X-Brain-ID': 'brain123'}},
            {'type': 'microsandbox'}
        ]

        with patch.object(MCPHelper, 'create_mcp_config') as mock_config, \
             patch.object(MCPHelper, 'create_mcp_toolset') as mock_toolset:

            mock_config.side_effect = [MagicMock(), MagicMock()]
            mock_toolset.side_effect = [MagicMock(), MagicMock()]

            result = MCPHelper.create_toolsets(mcp_configs)

            assert len(result) == 2
            assert mock_config.call_count == 2
            assert mock_toolset.call_count == 2
