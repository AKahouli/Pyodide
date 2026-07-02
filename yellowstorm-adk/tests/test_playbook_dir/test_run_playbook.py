"""Unit tests for execute_playbook_with_agent_team."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.schema.chatbot_schema import AgentSuggestion
from src.schema.playbook import RunPlaybookRequest, RunPlaybookStepRequest
from src.smart_rag.playbook_dir.run_playbook import execute_playbook_with_agent_team


def _step(task: str) -> RunPlaybookStepRequest:
    agent = AgentSuggestion(name="search_agent", description="d", prompt="p")
    return RunPlaybookStepRequest(
        messageId="msg-1",
        userId="user-1",
        taskId="task-1",
        taskDescription=task,
        order=1,
        agent=agent,
        manager_agent=agent,
        call_id="call-1",
        vectorstore_name="vs",
    )


def _playbook_request() -> RunPlaybookRequest:
    manager = AgentSuggestion(name="manager", description="md", prompt="mono")
    step = _step("Find data")
    return RunPlaybookRequest(
        playbook_id="pb-1",
        playbook_name="Test Playbook",
        user_id="user-1",
        session_id="sess-1",
        message="run it",
        manager_prompt="mgr###section",
        manager_agent=manager,
        steps=[step],
        chatbot_name={"provider": "gpt-4o"},
        agent_mode="manual",
        vectorstore_name="vs",
    )


class TestRunPlaybook:
    @pytest.mark.asyncio
    async def test_execute_playbook_calls_run_agent_team_logic(self):
        request = _playbook_request()
        queue = AsyncMock()

        with patch(
            "src.smart_rag.playbook_dir.run_playbook.construct_workplan",
            return_value="workplan-body",
        ), patch(
            "src.smart_rag.playbook_dir.run_playbook.construct_manager_prompt",
            return_value=("overridden", "manager-mono"),
        ), patch(
            "src.smart_rag.playbook_dir.run_playbook.run_agent_team_logic",
            new_callable=AsyncMock,
        ) as mock_run:
            await execute_playbook_with_agent_team(request, queue)

        mock_run.assert_awaited_once()
        team_request = mock_run.await_args[0][0]
        assert team_request.agent_mode == "manual"
        assert team_request.manager_prompt == "overridden"
        assert request.manager_agent.prompt == "manager-mono"
        assert len(team_request.available_agents) == 1
        assert team_request.available_agents[0]["name"] == "search_agent"

    @pytest.mark.asyncio
    async def test_execute_playbook_reraises_on_failure(self):
        request = _playbook_request()
        queue = AsyncMock()

        with patch(
            "src.smart_rag.playbook_dir.run_playbook.construct_workplan",
            return_value="wp",
        ), patch(
            "src.smart_rag.playbook_dir.run_playbook.construct_manager_prompt",
            return_value=("o", "m"),
        ), patch(
            "src.smart_rag.playbook_dir.run_playbook.run_agent_team_logic",
            new_callable=AsyncMock,
            side_effect=RuntimeError("boom"),
        ):
            with pytest.raises(RuntimeError, match="boom"):
                await execute_playbook_with_agent_team(request, queue)
