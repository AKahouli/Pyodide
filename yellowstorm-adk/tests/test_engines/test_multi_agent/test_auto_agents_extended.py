"""Extended unit tests for auto_agents workflow."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.smart_rag.engines.multi_agent.agentic_workflows.auto_agents import (
    _run_team_with_suggestions,
    handle_no_agents_workflow,
)


def _user_request():
    return SimpleNamespace(
        session_id="sess-1",
        message="analyze revenue",
        manager_prompt="###" * 8,
        agents=[],
        available_agents=[],
        available_tools=[],
        brain_documents=[],
        brain_relations={},
    )


def _team():
    team = MagicMock()
    team.agent_repository = MagicMock()
    team.prompt_processor.extract_prompts.return_value = ["p"] * 8
    team.get_agent_suggestions = AsyncMock(return_value=[{"name": "SearchAgent", "id": "a1"}])
    team._message_helper._send_suggestions = AsyncMock()
    return team


class TestAutoAgentsExtended:
    @pytest.mark.asyncio
    async def test_handle_no_agents_workflow_success(self):
        team = _team()
        user_request = _user_request()
        queue = AsyncMock()
        main_trace = MagicMock()
        with patch(
            "src.smart_rag.engines.multi_agent.agentic_workflows.auto_agents.langfuse_client"
        ) as mock_lf, patch(
            "src.smart_rag.engines.multi_agent.agentic_workflows.auto_agents._run_team_with_suggestions",
            new_callable=AsyncMock,
        ) as mock_run:
            mock_lf.span.return_value = MagicMock()
            await handle_no_agents_workflow(team, user_request, queue, main_trace)
        team.get_agent_suggestions.assert_awaited()
        mock_run.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handle_no_agents_workflow_retries_then_empty(self):
        team = _team()
        team.get_agent_suggestions = AsyncMock(return_value=None)
        user_request = _user_request()
        queue = AsyncMock()
        with patch(
            "src.smart_rag.engines.multi_agent.agentic_workflows.auto_agents.langfuse_client"
        ) as mock_lf, patch(
            "src.smart_rag.engines.multi_agent.agentic_workflows.auto_agents._run_team_with_suggestions",
            new_callable=AsyncMock,
        ) as mock_run:
            mock_lf.span.return_value = MagicMock()
            await handle_no_agents_workflow(team, user_request, queue, MagicMock())
        assert team.get_agent_suggestions.await_count == 3
        mock_run.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_run_team_with_suggestions(self):
        team = MagicMock()
        team.prompt_processor.extract_prompts.return_value = ["p"] * 9
        team.agent_helper.get_manager_prompt_from_agents.return_value = "manager"
        team.agent_helper.get_temperature_from_agents.return_value = 0.0
        team.agent_helper.get_manager_memory_from_agents.return_value = False
        team.agent_helper.get_html_prompt_from_agents.return_value = "html"
        team.agent_helper._build_file_context_prompt.return_value = ""
        team.agent_helper.pre_agent_run_config = MagicMock()
        team.agent_repository.set_agents = MagicMock()
        team.run_agent_team = AsyncMock()
        team.config = SimpleNamespace(attached_files=None, attached_images=None, previous_attached_files=None)
        user_request = _user_request()
        user_request.chatbot_name = "bot"
        user_request.search_web = False
        user_request.image_input = None
        user_request.available_agents = []
        agents = [{"name": "SearchAgent", "id": "a1"}]
        with patch(
            "src.smart_rag.engines.multi_agent.agentic_workflows.auto_agents.langfuse_client"
        ) as mock_lf, patch(
            "src.smart_rag.engines.multi_agent.agentic_workflows.auto_agents.DocumentHelpers"
        ) as mock_docs:
            mock_lf.span.return_value = MagicMock()
            mock_docs.merge_user_request_brain_documents_into_agents.return_value = agents
            mock_docs.merge_agents_brain_data.return_value = ([], {})
            await _run_team_with_suggestions(team, user_request, agents, AsyncMock(), MagicMock())
        team.run_agent_team.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handle_no_agents_workflow_exception(self):
        team = _team()
        team.get_agent_suggestions = AsyncMock(side_effect=RuntimeError("boom"))
        with patch(
            "src.smart_rag.engines.multi_agent.agentic_workflows.auto_agents.langfuse_client"
        ) as mock_lf:
            span = MagicMock()
            mock_lf.span.return_value = span
            await handle_no_agents_workflow(team, _user_request(), AsyncMock(), MagicMock())
        span.event.assert_called()
