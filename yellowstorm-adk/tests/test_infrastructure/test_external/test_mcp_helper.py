"""Tests for MCP Helper."""

import pytest
from unittest.mock import MagicMock, patch, AsyncMock
import json
import base64

from src.smart_rag.infrastructure.external.mcp_helper import MCPHelper


class TestMCPHelper:
    """Test cases for MCPHelper."""

    def test_init(self):
        """Test MCP helper initialization."""
        helper = MCPHelper()
        assert helper is not None

    def test_create_excel_mcp_headers(self):
        """Test creating Excel MCP headers."""
        user_id = "user123"
        workspace_names = ["brain456"]
        session_id = "session789"
        # extract_minimal_fields now requires 'filepath' to include a document
        brain_documents = [{"filepath": "/path/test.txt", "filename": "test.txt", "_id": "doc1", "extra": "ignored"}]

        result = MCPHelper.create_excel_mcp_headers(user_id, workspace_names, session_id, brain_documents)

        assert result is not None
        assert result["X-User-ID"] == user_id
        assert result["X-Brain-ID"] == workspace_names[0]
        assert result["X-Message-ID"] == session_id
        assert "X-Brain-Documents" in result

        # Verify the brain documents are properly encoded (should contain only minimal fields)
        decoded_docs = base64.b64decode(result["X-Brain-Documents"]).decode('utf-8')
        expected_minimal = [{"filepath": "/path/test.txt", "filename": "test.txt", "_id": "doc1"}]
        assert json.loads(decoded_docs) == expected_minimal

    def test_create_excel_mcp_headers_empty_workspace_names(self):
        """Test creating Excel MCP headers with empty brain IDs."""
        user_id = "user123"
        workspace_names = []
        session_id = "session789"
        brain_documents = []

        result = MCPHelper.create_excel_mcp_headers(user_id, workspace_names, session_id, brain_documents)

        # Should return None due to IndexError when accessing workspace_names[0]
        assert result is None

    def test_create_excel_mcp_headers_invalid_documents(self):
        """Test creating Excel MCP headers with documents that cause JSON serialization error."""
        user_id = "user123"
        workspace_names = ["brain456"]
        session_id = "session789"
        # Create a document with a circular reference in one of the minimal fields (filepath)
        circular_ref = {}
        circular_ref["circular"] = circular_ref
        brain_documents = [{"filepath": circular_ref, "filename": "test.txt", "_id": "doc1"}]

        result = MCPHelper.create_excel_mcp_headers(user_id, workspace_names, session_id, brain_documents)

        # Should return None due to JSON serialization error when the circular reference is in a minimal field
        assert result is None

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

    @pytest.mark.asyncio
    async def test_upload_files_to_datalake_success(self):
        """Test successful file upload to datalake."""
        user_id = "user123"
        workspace_name = "brain456"
        message_id = "msg789"

        mock_result = MagicMock()
        mock_result.isError = False
        mock_result.content = [MagicMock()]
        mock_result.content[0].text = '{"status": "success", "uploaded_files": 5}'

        with patch('src.smart_rag.infrastructure.external.mcp_helper.sse_client') as mock_sse_client, \
             patch('src.smart_rag.infrastructure.external.mcp_helper.ClientSession') as mock_client_session:

            # Mock the async context managers
            mock_streams = [MagicMock(), MagicMock()]
            mock_sse_gen = AsyncMock()
            mock_sse_gen.__aenter__ = AsyncMock(return_value=mock_streams)
            mock_sse_gen.__aexit__ = AsyncMock(return_value=None)
            mock_sse_client.return_value = mock_sse_gen

            mock_session = MagicMock()
            mock_session.__aenter__ = AsyncMock(return_value=mock_session)
            mock_session.__aexit__ = AsyncMock(return_value=None)
            mock_session.initialize = AsyncMock()
            mock_session.call_tool = AsyncMock(return_value=mock_result)
            mock_client_session.return_value = mock_session

            result = await MCPHelper.upload_files_to_datalake(user_id, workspace_name, message_id)

            assert result["status"] == "success"
            assert result["uploaded_files"] == 5
            mock_session.call_tool.assert_called_once_with(
                "upload_files",
                arguments={
                    "user_id": user_id,
                    "brain_id": workspace_name,
                    "message_id": message_id
                }
            )

    @pytest.mark.asyncio
    async def test_upload_files_to_datalake_error(self):
        """Test file upload with tool error."""
        user_id = "user123"
        workspace_name = "brain456"
        message_id = "msg789"

        mock_result = MagicMock()
        mock_result.isError = True
        mock_result.content = [MagicMock()]
        mock_result.content[0].text = "Tool execution failed"

        with patch('src.smart_rag.infrastructure.external.mcp_helper.sse_client') as mock_sse_client, \
             patch('src.smart_rag.infrastructure.external.mcp_helper.ClientSession') as mock_client_session:

            mock_streams = [MagicMock(), MagicMock()]
            mock_sse_gen = AsyncMock()
            mock_sse_gen.__aenter__ = AsyncMock(return_value=mock_streams)
            mock_sse_gen.__aexit__ = AsyncMock(return_value=None)
            mock_sse_client.return_value = mock_sse_gen

            mock_session = MagicMock()
            mock_session.__aenter__ = AsyncMock(return_value=mock_session)
            mock_session.__aexit__ = AsyncMock(return_value=None)
            mock_session.initialize = AsyncMock()
            mock_session.call_tool = AsyncMock(return_value=mock_result)
            mock_client_session.return_value = mock_session

            result = await MCPHelper.upload_files_to_datalake(user_id, workspace_name, message_id)

            assert "error" in result
            assert "Tool error: Tool execution failed" in result["error"]

    @pytest.mark.asyncio
    async def test_upload_files_to_datalake_connection_error(self):
        """Test file upload with connection error."""
        user_id = "user123"
        workspace_name = "brain456"
        message_id = "msg789"

        with patch('src.smart_rag.infrastructure.external.mcp_helper.sse_client') as mock_sse_client:
            mock_sse_client.side_effect = ConnectionError("Unable to connect to MCP server")

            result = await MCPHelper.upload_files_to_datalake(user_id, workspace_name, message_id)

            assert "error" in result
            assert "Unable to connect to MCP server" in result["error"]

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
    def test_create_mcp_config_excel(self, mock_settings):
        """Test creating Excel MCP configuration."""
        mock_settings.EXCEL_MCP_URL = "https://localhost:8080"

        headers = {
            "X-User-ID": "user123",
            "X-Brain-ID": "brain456"
        }

        with patch('src.smart_rag.infrastructure.external.mcp_helper.SseServerParams') as mock_sse_params:
            mock_params = MagicMock()
            mock_sse_params.return_value = mock_params

            result = MCPHelper.create_mcp_config('excel', headers=headers)

            mock_sse_params.assert_called_once_with(
                url="https://localhost:8080",
                headers=headers
            )
            assert result == mock_params

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

    def test_create_mcp_toolset_success(self):
        """Test creating MCP toolset successfully."""
        connection_params = MagicMock()

        with patch('src.smart_rag.infrastructure.external.mcp_helper.MCPToolset') as mock_toolset_class:
            mock_toolset = MagicMock()
            mock_toolset_class.return_value = mock_toolset

            result = MCPHelper.create_mcp_toolset(connection_params, 'excel')

            mock_toolset_class.assert_called_once_with(connection_params=connection_params)
            assert result == mock_toolset
            assert result.mcp_type == 'excel'

    def test_create_mcp_toolset_default_type(self):
        """Test creating MCP toolset with default type."""
        connection_params = MagicMock()

        with patch('src.smart_rag.infrastructure.external.mcp_helper.MCPToolset') as mock_toolset_class:
            mock_toolset = MagicMock()
            mock_toolset_class.return_value = mock_toolset

            result = MCPHelper.create_mcp_toolset(connection_params)

            mock_toolset_class.assert_called_once_with(connection_params=connection_params)
            assert result == mock_toolset
            assert result.mcp_type == 'unknown'

    def test_create_mcp_toolset_import_error(self):
        """Test creating MCP toolset with import error."""
        connection_params = MagicMock()

        with patch('src.smart_rag.infrastructure.external.mcp_helper.MCPToolset', side_effect=ImportError("Module not found")):
            with pytest.raises(ImportError):
                MCPHelper.create_mcp_toolset(connection_params)

    def test_create_toolsets_success(self):
        """Test creating multiple toolsets successfully."""
        mcp_configs = [
            {'type': 'excel', 'headers': {'X-User-ID': 'user123'}},
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

    def test_create_toolsets_skip_excel_without_headers(self):
        """Test creating toolsets skips Excel without headers."""
        mcp_configs = [
            {'type': 'excel'},  # No headers
            {'type': 'microsandbox'}
        ]

        with patch.object(MCPHelper, 'create_mcp_config') as mock_config, \
             patch.object(MCPHelper, 'create_mcp_toolset') as mock_toolset:

            mock_config.return_value = MagicMock()
            mock_toolset.return_value = MagicMock()

            result = MCPHelper.create_toolsets(mcp_configs)

            assert len(result) == 1  # Only microsandbox should be created
            assert mock_config.call_count == 1
            assert mock_toolset.call_count == 1
