"""Additional runner coverage for structured responses and sandbox."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from src.smart_rag.agents.core.runner import AgentRunner


def _runner():
    return AgentRunner(MagicMock(), MagicMock(), MagicMock(), MagicMock())


class TestRunnerMore:
    @pytest.mark.asyncio
    async def test_handle_python_interpreter_response_streams_sandbox(self):
        runner = _runner()
        function_response = MagicMock()
        function_response.response = {"stdout": "42", "stderr": ""}
        function_response.id = "sandbox-1"
        queue = AsyncMock()
        runner.streaming_formatter.format_component_event.return_value = {"type": "sandbox"}
        await runner._handle_python_interpreter_response(
            function_response, "agent-1", "OperatorAgent", "sess-1", queue
        )
        queue.put.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handle_structured_tool_response_non_dict(self):
        runner = _runner()
        function_response = MagicMock()
        function_response.name = "tool"
        function_response.response = "plain-text"
        queue = AsyncMock()
        await runner._handle_structured_tool_response(
            function_response, "a1", "s1", queue, session_state={}
        )
        queue.put.assert_not_awaited()

    def test_registers_connector_citations_helpers(self):
        from src.smart_rag.agents.core.runner import (
            _is_locate_answer_citations_tool,
            _registers_connector_citations,
        )

        assert _is_locate_answer_citations_tool("x_locate_answer_citations") is True
        assert _registers_connector_citations("x_locate_answer_citations") is True
