"""Unit tests for WebSearchTool."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.smart_rag.tools.search.web_search import WebSearchTool


class TestWebSearchTool:
    @pytest.fixture
    def tool(self):
        with patch("linkup.LinkupClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client_cls.return_value = mock_client
            web_tool = WebSearchTool(api_key="test-key")
            web_tool.client = mock_client
            yield web_tool, mock_client

    @pytest.mark.asyncio
    async def test_web_search_returns_text_and_sources(self, tool):
        web_tool, client = tool
        response = SimpleNamespace(
            answer="Answer text",
            sources=[
                SimpleNamespace(name="Site", url="https://example.com", snippet="snippet"),
            ],
        )
        client.async_search = AsyncMock(return_value=response)

        result = await web_tool.web_search("climate policy", search_web="standard")

        assert "Answer text" in result["text"]
        assert len(result["sources"]) == 1
        assert result["sources"][0]["url"] == "https://example.com"

    @pytest.mark.asyncio
    async def test_web_search_deep_mode(self, tool):
        web_tool, client = tool
        client.async_search = AsyncMock(return_value=SimpleNamespace(answer="deep", sources=[]))
        await web_tool.web_search("query", search_web="deep")
        client.async_search.assert_awaited_once()
        assert client.async_search.await_args.kwargs["depth"] == "deep"

    @pytest.mark.asyncio
    async def test_web_search_handles_errors(self, tool):
        web_tool, client = tool
        client.async_search = AsyncMock(side_effect=RuntimeError("api down"))
        result = await web_tool.web_search("query")
        assert "Web search error" in result["text"]
        assert result["sources"] == []

    def test_format_search_response_without_sources(self, tool):
        web_tool, _ = tool
        response = SimpleNamespace(answer="only answer", sources=None)
        assert web_tool._format_search_response(response) == "only answer"

    def test_extract_sources_skips_unknown_types(self, tool):
        web_tool, _ = tool
        response = SimpleNamespace(
            sources=[
                SimpleNamespace(name="Good", url="https://ok", snippet="s"),
                object(),
            ]
        )
        sources = web_tool._extract_sources(response, "q")
        assert len(sources) == 1
        assert sources[0]["title"] == "Good"
