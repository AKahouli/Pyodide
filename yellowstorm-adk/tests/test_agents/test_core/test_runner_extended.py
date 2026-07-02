"""Extended unit tests for AgentRunner helper utilities and paths."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from google.genai import types

from src.smart_rag.agents.core.runner import (
    AgentRunner,
    _display_source_name,
    _log_payload,
    _normalize_reference_token,
    _normalize_vectorstore_source,
    _replace_citation_marker,
)


def _runner():
    return AgentRunner(MagicMock(), MagicMock(), MagicMock(), MagicMock())


class TestRunnerUtilityFunctions:
    def test_display_source_name_url(self):
        assert _display_source_name("https://x.com/path/file.pdf") == "file.pdf"

    def test_display_source_name_plain(self):
        assert _display_source_name("report.pdf") == "report.pdf"

    def test_normalize_vectorstore_source(self):
        assert _normalize_vectorstore_source("s3://vectorstore/user/doc.pdf") == "user/doc.pdf"

    def test_normalize_reference_token(self):
        assert _normalize_reference_token("[4]") == "4"

    def test_replace_citation_marker(self):
        assert _replace_citation_marker("see [4]", "4", "9") == "see [9]"

    def test_log_payload_serializes_dict(self):
        assert '"a"' in _log_payload({"a": 1})


class TestRunnerExtended:
    @pytest.mark.asyncio
    async def test_run_agent_tool_with_image_input(self):
        runner = _runner()
        agent = MagicMock()
        agent.name = "SearchAgent"
        session_helper = MagicMock()
        session_helper.create_session = AsyncMock(return_value=MagicMock())
        queue = AsyncMock()
        with patch(
            "src.smart_rag.agents.core.runner.build_content_with_images",
            return_value=types.Content(role="user", parts=[]),
        ) as mock_build, patch.object(
            runner, "_run_standard_agent", new_callable=AsyncMock, return_value=("ok", [], {}, [])
        ):
            result = await runner.run_agent_tool(
                agent=agent,
                message="describe",
                session_helper=session_helper,
                user_id="u1",
                q=queue,
                image_input=[{"img": "data:image/png;base64,abc"}],
            )
        mock_build.assert_called_once()
        assert result[0] == "ok"

    @pytest.mark.asyncio
    async def test_run_agent_tool_report_writer_agent_type(self):
        runner = _runner()
        runner.prompt_processor.extract_task_description.return_value = "task"
        runner.streaming_formatter.format_streaming_event.return_value = {"type": "description"}
        agent = MagicMock()
        agent.name = "ReportWriterAgent"
        session_helper = MagicMock()
        session_helper.create_session = AsyncMock(return_value=MagicMock())
        with patch.object(
            runner, "_run_standard_agent", new_callable=AsyncMock, return_value=("report", [], {}, [])
        ):
            result = await runner.run_agent_tool(
                agent=agent,
                message="write",
                session_helper=session_helper,
                user_id="u1",
                q=AsyncMock(),
            )
        assert result[0] == "report"

    @pytest.mark.asyncio
    async def test_find_source_by_reference_from_toolkit(self):
        runner = _runner()
        toolkit = MagicMock()
        toolkit.sources_text = [{"reference": "2", "object": {"content": {"source": "doc"}}}]
        toolkit.sources_image = []
        source = runner._find_source_by_reference("2", toolkit, {})
        assert source is not None
        assert source["type"] == "text"

    def test_find_source_by_reference_image_source(self):
        runner = _runner()
        toolkit = MagicMock()
        toolkit.sources_text = []
        toolkit.sources_image = [{"reference": "3", "object": {"content": {"source": "img.png"}}}]
        source = runner._find_source_by_reference("3", toolkit, {})
        assert source["type"] == "image"

    @pytest.mark.asyncio
    async def test_handle_structured_tool_response_with_sources_list(self):
        runner = _runner()
        function_response = MagicMock()
        function_response.name = "searchv2test_locate_answer_citations"
        function_response.response = {
            "text": "answer",
            "sources": [{"title": "Web", "url": "https://x"}],
        }
        queue = AsyncMock()
        runner.streaming_formatter.format_component_event.return_value = {"type": "sources"}
        await runner._handle_structured_tool_response(
            function_response=function_response,
            agent_id="a1",
            session_id="s1",
            q=queue,
        )
        queue.put.assert_awaited_once()
