"""Extended MCPHelper coverage for type extraction and microsandbox helpers."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from google.adk.tools.mcp_tool import MCPToolset

from src.smart_rag.infrastructure.external.mcp_helper import MCPHelper


class TestMCPHelperTypeExtraction:
    def test_extract_requested_mcp_types_from_tools_and_params(self):
        tools = [{"mcp_type": "github,microsandbox"}, {"mcp_type": "vectorstore"}]
        params = {"mcp_types": "github"}
        result = MCPHelper.extract_requested_mcp_types(tools, params)
        assert result == ["github", "microsandbox", "vectorstore"]

    def test_has_requested_mcp_type(self):
        assert MCPHelper.has_requested_mcp_type(
            "github",
            tools=[{"mcp_type": "github"}],
        )
        assert not MCPHelper.has_requested_mcp_type("unknown", tools=[])

    def test_get_mcp_type_from_toolset(self):
        toolset = MagicMock()
        toolset.mcp_type = "vectorstore"
        assert MCPHelper.get_mcp_type_from_toolset(toolset) == "vectorstore"
        assert MCPHelper.get_mcp_type_from_toolset(object()) == "unknown"


class TestMCPHelperMicrosandbox:
    @pytest.mark.asyncio
    async def test_identify_mcp_for_function_microsandbox(self):
        toolset = MagicMock(spec=MCPToolset)
        toolset.mcp_type = "microsandbox"
        agent = MagicMock()
        agent.tools = [toolset]
        result = await MCPHelper.identify_mcp_for_function(agent, "sandbox_run_code")
        assert result == "microsandbox"

    @pytest.mark.asyncio
    async def test_identify_mcp_for_function_unknown(self):
        agent = MagicMock()
        agent.tools = []
        result = await MCPHelper.identify_mcp_for_function(agent, "search")
        assert result is None

    @pytest.mark.asyncio
    async def test_get_microsandbox_uploaded_files_success(self):
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={"uploaded_files": [{"filename": "a.csv"}]})

        mock_get = AsyncMock()
        mock_get.__aenter__ = AsyncMock(return_value=mock_response)
        mock_get.__aexit__ = AsyncMock(return_value=None)

        mock_session = MagicMock()
        mock_session.get.return_value = mock_get
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=None)

        with patch("src.smart_rag.infrastructure.external.mcp_helper.app_settings") as settings, patch(
            "src.smart_rag.infrastructure.external.mcp_helper.aiohttp.ClientSession",
            return_value=mock_session,
        ):
            settings.MICROSANDBOX_DOCUMENT_SERVER_URL = "http://sandbox-docs"
            files = await MCPHelper.get_microsandbox_uploaded_files("brain-1", "sess-1")
        assert files == [{"filename": "a.csv"}]

    @pytest.mark.asyncio
    async def test_get_microsandbox_uploaded_files_missing_url(self):
        with patch("src.smart_rag.infrastructure.external.mcp_helper.app_settings") as settings:
            settings.MICROSANDBOX_DOCUMENT_SERVER_URL = ""
            files = await MCPHelper.get_microsandbox_uploaded_files("brain-1", "sess-1")
        assert files == []


class TestMCPHelperVectorstore:
    @patch("src.smart_rag.infrastructure.external.mcp_helper.app_settings")
    def test_create_vectorstore_toolsets_with_deep_search(self, mock_settings):
        mock_settings.VECTORSTORE_MCP_URL = "http://vectorstore-mcp"
        with patch.object(MCPHelper, "create_mcp_config", return_value=MagicMock()) as mock_config, patch.object(
            MCPHelper, "create_mcp_toolset", return_value=MagicMock()
        ) as mock_toolset:
            toolsets = MCPHelper.create_vectorstore_toolsets_with_deep_search(
                brain_ids=["b1", "b2"],
                deep_search=True,
            )
        assert len(toolsets) == 1
        mock_config.assert_called_once()
        mock_toolset.assert_called_once()
        config_call = mock_config.call_args
        assert config_call[0][0] == "vectorstore"
        assert config_call[1]["headers"]["X-Deep-Search"] == "true"

    @patch("src.smart_rag.infrastructure.external.mcp_helper.app_settings")
    def test_create_vectorstore_toolsets_raises_when_url_missing(self, mock_settings):
        mock_settings.VECTORSTORE_MCP_URL = ""
        with pytest.raises(ValueError, match="VECTORSTORE_MCP_URL"):
            MCPHelper.create_vectorstore_toolsets_with_deep_search()
