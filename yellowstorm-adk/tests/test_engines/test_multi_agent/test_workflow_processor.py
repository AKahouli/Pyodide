"""Unit tests for workflow_processor."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.schema.chatbot_schema import RunAgentTeamRequest
from src.smart_rag.engines.multi_agent.workflow_processor import (
    execute_workflow,
    run_agent_team_logic,
)


def _team_request(agent_mode: str = "manual") -> RunAgentTeamRequest:
    return RunAgentTeamRequest(
        user_id="user-1",
        session_id="sess-1",
        message="hello",
        manager_prompt="mgr###a###b###c###d###e###f###g###h###i",
        chatbot_name={"provider": "gpt-4o"},
        agent_mode=agent_mode,
        agents=[],
    )


class TestWorkflowProcessor:
    @pytest.mark.asyncio
    async def test_execute_workflow_routes_auto_mode(self):
        team = MagicMock()
        request = _team_request("auto")
        queue = AsyncMock()

        with patch(
            "src.smart_rag.engines.multi_agent.workflow_processor.handle_no_agents_workflow",
            new_callable=AsyncMock,
        ) as mock_auto:
            await execute_workflow(team, request, queue)
        mock_auto.assert_awaited_once_with(team, request, queue)
        assert queue.include_tool_results is True

    @pytest.mark.asyncio
    async def test_execute_workflow_routes_manual_mode(self):
        team = MagicMock()
        request = _team_request("manual")
        queue = AsyncMock()

        with patch(
            "src.smart_rag.engines.multi_agent.workflow_processor.handle_agents_provided_workflow",
            new_callable=AsyncMock,
        ) as mock_manual:
            await execute_workflow(team, request, queue)
        mock_manual.assert_awaited_once_with(team, request, queue)

    @pytest.mark.asyncio
    async def test_execute_workflow_routes_mono_mode(self):
        team = MagicMock()
        request = _team_request("mono")
        queue = AsyncMock()

        with patch(
            "src.smart_rag.engines.multi_agent.workflow_processor.handle_single_agent_workflow",
            new_callable=AsyncMock,
        ) as mock_mono:
            await execute_workflow(team, request, queue)
        mock_mono.assert_awaited_once_with(team, request, queue)

    @pytest.mark.asyncio
    async def test_execute_workflow_routes_hierarchical_mode(self):
        team = MagicMock()
        request = _team_request("hierarchical")
        queue = AsyncMock()
        with patch(
            "src.smart_rag.engines.multi_agent.workflow_processor.handle_hierarchical_agents_workflow",
            new_callable=AsyncMock,
        ) as mock_hierarchical:
            await execute_workflow(team, request, queue)
        mock_hierarchical.assert_awaited_once_with(team, request, queue)

    @pytest.mark.asyncio
    async def test_run_agent_team_logic_success(self):
        request = _team_request("manual")
        queue = AsyncMock()
        team = MagicMock()

        with patch(
            "src.smart_rag.engines.multi_agent.workflow_processor.initialize_dependencies",
            return_value={},
        ), patch(
            "src.smart_rag.engines.multi_agent.workflow_processor.create_team_config",
            return_value=MagicMock(),
        ), patch(
            "src.smart_rag.engines.multi_agent.workflow_processor.create_team",
            return_value=team,
        ), patch(
            "src.smart_rag.engines.multi_agent.workflow_processor.execute_workflow",
            new_callable=AsyncMock,
        ) as mock_execute:
            await run_agent_team_logic(request, queue)

        mock_execute.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_run_agent_team_logic_sends_error_on_failure(self):
        request = _team_request("manual")
        queue = AsyncMock()
        team = MagicMock()
        team._message_helper._send_error_message = AsyncMock()

        with patch(
            "src.smart_rag.engines.multi_agent.workflow_processor.initialize_dependencies",
            return_value={},
        ), patch(
            "src.smart_rag.engines.multi_agent.workflow_processor.create_team_config",
            return_value=MagicMock(),
        ), patch(
            "src.smart_rag.engines.multi_agent.workflow_processor.create_team",
            return_value=team,
        ), patch(
            "src.smart_rag.engines.multi_agent.workflow_processor.execute_workflow",
            new_callable=AsyncMock,
            side_effect=RuntimeError("orchestration failed"),
        ):
            await run_agent_team_logic(request, queue)

        team._message_helper._send_error_message.assert_awaited_once()
