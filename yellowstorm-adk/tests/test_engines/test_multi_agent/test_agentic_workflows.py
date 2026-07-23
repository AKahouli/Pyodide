"""Unit tests for agentic workflow handlers."""

from unittest.mock import ANY, AsyncMock, MagicMock, patch

import pytest

from src.schema.chatbot_schema import AgentSuggestion, RunAgentTeamRequest
from src.smart_rag.engines.multi_agent.agentic_workflows.auto_agents import (
    handle_no_agents_workflow,
)
from src.smart_rag.engines.multi_agent.agentic_workflows.manual_agents import (
    handle_agents_provided_workflow,
)
from src.smart_rag.engines.multi_agent.agentic_workflows.single_agent import (
    handle_single_agent_workflow,
)


def _manager_prompt() -> str:
    return "###s1###s2###s3###html###mgr1###mgr2###report###suggest###htmlfmt"


def _team_request(agent_mode: str = "manual", agents=None) -> RunAgentTeamRequest:
    return RunAgentTeamRequest(
        user_id="user-1",
        session_id="sess-1",
        message="do work",
        manager_prompt=_manager_prompt(),
        chatbot_name={"provider": "gpt-4o"},
        agent_mode=agent_mode,
        agents=agents or [],
        available_agents=[],
    )


def _worker_agent(name: str = "worker") -> AgentSuggestion:
    return AgentSuggestion(
        id="w-1",
        name=name,
        description="worker agent",
        prompt="do tasks",
        tools=[],
        chatbot_name={"provider": "gpt-4o"},
        vectorstore_name="vs",
    )


def _mock_team():
    team = MagicMock()
    team.agent_repository = MagicMock()
    team.agent_repository.add_agent = MagicMock()
    team.agent_repository.get_all_agents.return_value = []
    team.prompt_processor.extract_prompts.return_value = tuple(f"p{i}" for i in range(9))
    team.agent_helper.get_manager_prompt_from_agents.return_value = "manager prompt"
    team.agent_helper.get_temperature_from_agents.return_value = 0.2
    team.agent_helper.get_manager_memory_from_agents.return_value = False
    team.agent_helper.get_html_prompt_from_agents.return_value = "html prompt"
    team.agent_helper._prepare_agent_data.side_effect = (
        lambda agent, *_: agent.model_dump() if hasattr(agent, "model_dump") else agent
    )
    team.agent_helper._create_enhanced_manager_prompt.return_value = "enhanced"
    team.agent_helper.pre_agent_run_config = MagicMock()
    team.get_agent_suggestions = AsyncMock(return_value=[{"id": "new-1", "name": "worker"}])
    team.run_agent_team = AsyncMock()
    team.run_single_agent = AsyncMock()
    team._message_helper._send_suggestions = AsyncMock()
    team._message_helper._send_error_message = AsyncMock()
    team.config = MagicMock()
    return team


def _main_trace():
    trace = MagicMock()
    trace.id = "trace-1"
    return trace


class TestAutoAgentsWorkflow:
    @pytest.mark.asyncio
    async def test_handle_no_agents_workflow_generates_and_runs(self):
        team = _mock_team()
        request = _team_request("auto", agents=[AgentSuggestion(
            id="mgr",
            name="manager",
            description="manager agent",
            prompt="manage",
        )])
        queue = AsyncMock()
        trace = _main_trace()

        with patch(
            "src.smart_rag.engines.multi_agent.agentic_workflows.auto_agents._run_team_with_suggestions",
            new_callable=AsyncMock,
        ) as mock_run:
            await handle_no_agents_workflow(team, request, queue, trace)

        team.get_agent_suggestions.assert_awaited()
        team._message_helper._send_suggestions.assert_awaited()
        mock_run.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handle_no_agents_workflow_empty_suggestions_still_streams(self):
        team = _mock_team()
        team.get_agent_suggestions = AsyncMock(return_value=[])
        request = _team_request("auto")
        queue = AsyncMock()
        trace = _main_trace()

        with patch(
            "src.smart_rag.engines.multi_agent.agentic_workflows.auto_agents._run_team_with_suggestions",
            new_callable=AsyncMock,
        ):
            await handle_no_agents_workflow(team, request, queue, trace)

        team._message_helper._send_suggestions.assert_awaited()


class TestManualAgentsWorkflow:
    @pytest.mark.asyncio
    async def test_handle_agents_provided_workflow_runs_team(self):
        team = _mock_team()
        worker = _worker_agent()
        request = _team_request("manual", agents=[worker])

        with patch(
            "src.smart_rag.engines.multi_agent.agentic_workflows.manual_agents.DocumentHelpers"
        ) as mock_docs, patch(
            "src.smart_rag.engines.multi_agent.agentic_workflows.manual_agents._run_provided_agent_team",
            new_callable=AsyncMock,
        ) as mock_run:
            mock_docs.agent_to_dict.side_effect = (
                lambda agent: agent.model_dump() if hasattr(agent, "model_dump") else agent
            )
            mock_docs.merge_user_request_brain_documents_into_agents.side_effect = (
                lambda agents, _req: agents
            )
            mock_docs.merge_agents_brain_data.return_value = (
                [],
                {"nodes": [], "relationships": []},
            )
            mock_docs.update_agents_in_list_by_mapping = MagicMock()
            await handle_agents_provided_workflow(
                team, request, AsyncMock(), _main_trace()
            )

        mock_run.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handle_agents_provided_workflow_adds_deep_search_tool(self):
        team = _mock_team()
        worker = _worker_agent()
        request = _team_request("manual", agents=[worker])
        request.deep_search_enabled = True

        with patch(
            "src.smart_rag.engines.multi_agent.agentic_workflows.manual_agents.DocumentHelpers"
        ) as mock_docs:
            mock_docs.agent_to_dict.side_effect = (
                lambda agent: agent.model_dump() if hasattr(agent, "model_dump") else agent
            )
            mock_docs.merge_user_request_brain_documents_into_agents.side_effect = (
                lambda agents, _req: agents
            )
            mock_docs.merge_agents_brain_data.return_value = (
                [],
                {"nodes": [], "relationships": []},
            )
            mock_docs.update_agents_in_list_by_mapping = MagicMock()
            await handle_agents_provided_workflow(
                team, request, AsyncMock(), _main_trace()
            )

        assert any(t.get("name") == "deep_search" for t in worker.tools)


class TestSingleAgentWorkflow:
    @pytest.mark.asyncio
    async def test_handle_single_agent_workflow_runs_agent(self):
        team = _mock_team()
        worker = _worker_agent()
        request = _team_request("mono", agents=[worker])
        request.task_summary = "Profitability"

        with patch(
            "src.smart_rag.engines.multi_agent.agentic_workflows.single_agent.DocumentHelpers"
        ) as mock_docs, patch.object(team, "run_single_agent", new_callable=AsyncMock) as mock_run:
            mock_docs.agent_to_dict.side_effect = (
                lambda agent: agent.model_dump() if hasattr(agent, "model_dump") else agent
            )
            mock_docs.merge_user_request_brain_documents_into_agents.side_effect = (
                lambda agents, _req: agents
            )
            await handle_single_agent_workflow(team, request, AsyncMock(), _main_trace())

        mock_run.assert_awaited_once_with(
            user_prompt=request.message,
            session_id=request.session_id,
            q=ANY,
            parent_trace=ANY,
            image_input=request.image_input,
            task_summary="Profitability",
        )
        team._message_helper._send_error_message.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_handle_single_agent_workflow_missing_agent_sends_error(self):
        team = _mock_team()
        request = _team_request("mono", agents=[])

        with patch(
            "src.smart_rag.engines.multi_agent.agentic_workflows.single_agent.DocumentHelpers"
        ) as mock_docs:
            mock_docs.agent_to_dict.return_value = {"agent_type": "manager"}
            await handle_single_agent_workflow(team, request, AsyncMock(), _main_trace())

        team._message_helper._send_error_message.assert_awaited_once()
