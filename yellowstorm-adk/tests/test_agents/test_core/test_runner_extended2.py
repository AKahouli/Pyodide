"""Extended runner coverage for citations, handlers, and connector sources."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from src.smart_rag.agents.core.runner import (
    AgentRunner,
    _STATE_KEY_CONNECTOR_TEXT_SOURCES,
    _loggable_structured_response,
)


def _runner():
    return AgentRunner(MagicMock(), MagicMock(), MagicMock(), MagicMock())


class TestRunnerCitationHelpers:
    def test_loggable_structured_response_omits_non_locator(self):
        assert _loggable_structured_response("search", {"text": "x"}) == (
            "[non-locator structured response omitted]"
        )
        assert _loggable_structured_response(
            "search_locate_answer_citations", {"text": "x"}
        ) == {"text": "x"}

    def test_extract_page_number_variants(self):
        runner = _runner()
        assert runner._extract_page_number("doc.pdf - page 12") == "12"
        assert runner._extract_page_number("7") == "7"
        assert runner._extract_page_number("") == ""

    def test_build_connector_source_signature_image(self):
        runner = _runner()
        sig = runner._build_connector_source_signature(
            {
                "type": "image",
                "path": "/img.png",
                "file_name": "img.png",
                "page": "1",
                "highlight_text": "label",
            }
        )
        assert "image" in sig
        assert "img.png" in sig

    def test_find_source_by_reference_connector_aliases(self):
        runner = _runner()
        session_state = {
            _STATE_KEY_CONNECTOR_TEXT_SOURCES: [
                {
                    "reference": "5",
                    "reference_aliases": ["[5]", "alias-5"],
                    "object": {
                        "content": {
                            "source": "doc.pdf",
                            "file_name": "doc.pdf",
                            "page": "2",
                        }
                    },
                }
            ]
        }
        source = runner._find_source_by_reference(
            "alias-5", MagicMock(sources_text=[], sources_image=[]), session_state
        )
        assert source is not None
        assert source["type"] == "text"

    def test_extract_connector_citation_sources_from_citations(self):
        runner = _runner()
        sources = runner._extract_connector_citation_sources_from_response(
            {
                "citations": [
                    {
                        "source": "s3://vectorstore/user/report.pdf",
                        "page": "3",
                        "highlight_text": "revenue",
                        "reference": "1",
                    }
                ]
            },
            "search_locate_answer_citations",
        )
        assert len(sources) == 1
        assert sources[0]["file_name"] == "report.pdf"

    def test_register_connector_citation_sources_dedupes(self):
        runner = _runner()
        session_state = {}
        response = {
            "citation_sources": [
                {
                    "type": "text",
                    "source": "doc.pdf",
                    "file_name": "doc.pdf",
                    "page": "1",
                    "page_content": "same",
                },
                {
                    "type": "text",
                    "source": "doc.pdf",
                    "file_name": "doc.pdf",
                    "page": "1",
                    "page_content": "same",
                },
            ]
        }
        runner._register_connector_citation_sources_from_response(
            response, session_state, "tool_locate_answer_citations"
        )
        assert len(session_state[_STATE_KEY_CONNECTOR_TEXT_SOURCES]) == 1


class TestRunnerResponseHandlers:
    @pytest.mark.asyncio
    async def test_handle_dataviz_response(self):
        runner = _runner()
        function_response = MagicMock()
        function_response.name = "dataviz"
        function_response.response = {"ui": {"title": "Chart"}}
        queue = AsyncMock()
        await runner._handle_dataviz_response(
            function_response, "agent-1", "SearchAgent", "sess-1", queue
        )
        queue.put.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handle_formviz_response(self):
        runner = _runner()
        model = MagicMock()
        model.model_dump.return_value = {"type": "resource"}
        function_response = MagicMock()
        function_response.name = "formviz"
        function_response.response = {"content": [model]}
        queue = AsyncMock()
        await runner._handle_formviz_response(
            function_response, "agent-1", "SearchAgent", "sess-1", queue
        )
        queue.put.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handle_web_search_response(self):
        runner = _runner()
        function_response = MagicMock()
        function_response.response = {
            "text": "answer",
            "sources": [{"title": "Site", "url": "https://example.com"}],
        }
        queue = AsyncMock()
        runner.streaming_formatter.format_component_event.return_value = {"type": "sources"}
        await runner._handle_web_search_response(
            function_response, "agent-1", "sess-1", queue
        )
        queue.put.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handle_ui_tool_response_emits_chart(self):
        runner = _runner()
        function_response = MagicMock()
        function_response.id = "chart-1"
        function_response.response = {
            "title": "Revenue",
            "chartData": [{"x": 1, "y": 2}],
            "kind": "bar",
        }
        queue = AsyncMock()
        runner.streaming_formatter.format_component_event.return_value = {"type": "chart"}
        handled = await runner._handle_ui_tool_response(
            "render_chart", function_response, "agent-1", "sess-1", queue
        )
        assert handled is True
        queue.put.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handle_ui_tool_response_rejects_invalid_chart(self):
        runner = _runner()
        function_response = MagicMock()
        function_response.response = {"error": True, "details": "bad data"}
        queue = AsyncMock()
        handled = await runner._handle_ui_tool_response(
            "render_chart", function_response, "agent-1", "sess-1", queue
        )
        assert handled is True
        queue.put.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_handle_ui_tool_response_emits_choice(self):
        runner = _runner()
        function_response = MagicMock()
        function_response.id = "choice-1"
        function_response.response = {
            "schemaVersion": 1,
            "status": "ready",
            "options": [{"id": "one"}, {"id": "two"}],
        }
        queue = AsyncMock()
        runner.streaming_formatter.format_component_event.return_value = {"type": "choice"}

        handled = await runner._handle_ui_tool_response(
            "present_choices", function_response, "agent-1", "sess-1", queue
        )

        assert handled is True
        queue.put.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handle_ui_tool_response_rejects_invalid_choice(self):
        runner = _runner()
        function_response = MagicMock()
        function_response.response = {"schemaVersion": 2, "status": "ready", "options": []}
        queue = AsyncMock()

        handled = await runner._handle_ui_tool_response(
            "present_choices", function_response, "agent-1", "sess-1", queue
        )

        assert handled is True
        queue.put.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_handle_ui_tool_response_emits_web_preview(self):
        runner = _runner()
        function_response = MagicMock()
        function_response.id = "preview-1"
        function_response.response = {
            "schemaVersion": 1,
            "status": "ready",
            "content": "<html><body>Preview</body></html>",
        }
        queue = AsyncMock()
        runner.streaming_formatter.format_component_event.return_value = {"type": "web_preview"}

        handled = await runner._handle_ui_tool_response(
            "generate_web_preview", function_response, "agent-1", "sess-1", queue
        )

        assert handled is True
        queue.put.assert_awaited_once()
        assert runner.streaming_formatter.format_component_event.call_args.kwargs["component_data"] == {
            "content": "<html><body>Preview</body></html>"
        }

    @pytest.mark.asyncio
    async def test_handle_ui_tool_response_rejects_unstructured_web_preview(self):
        runner = _runner()
        function_response = MagicMock()
        function_response.response = {"content": "<html></html>"}
        queue = AsyncMock()

        handled = await runner._handle_ui_tool_response(
            "generate_web_preview", function_response, "agent-1", "sess-1", queue
        )

        assert handled is True
        queue.put.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_send_citation_component_text(self):
        runner = _runner()
        queue = AsyncMock()
        runner.streaming_formatter.format_component_event.return_value = {"type": "citation"}
        await runner._send_citation_component(
            {
                "type": "text",
                "source_object": {
                    "content": {
                        "source": "doc.pdf",
                        "file_name": "doc.pdf",
                        "page": "2",
                        "page_content": "snippet",
                    }
                },
            },
            "agent-1",
            "sess-1",
            queue,
            "parent-1",
            citation_ref="[1]",
        )
        queue.put.assert_awaited_once()
