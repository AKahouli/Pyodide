"""Unit tests for agentic workflow handlers."""

from unittest.mock import ANY, AsyncMock, MagicMock, patch

import pytest

from src.schema.chatbot_schema import AgentSuggestion, RunAgentTeamRequest
from src.smart_rag.engines.multi_agent.agentic_workflows.auto_agents import (
    handle_no_agents_workflow,
)
from src.smart_rag.engines.multi_agent.agentic_workflows.manual_agents import (
    _run_provided_agent_team,
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

        with patch(
            "src.smart_rag.engines.multi_agent.agentic_workflows.auto_agents._run_team_with_suggestions",
            new_callable=AsyncMock,
        ) as mock_run:
            await handle_no_agents_workflow(team, request, queue)

        team.get_agent_suggestions.assert_awaited()
        team._message_helper._send_suggestions.assert_awaited()
        mock_run.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handle_no_agents_workflow_empty_suggestions_still_streams(self):
        team = _mock_team()
        team.get_agent_suggestions = AsyncMock(return_value=[])
        request = _team_request("auto")
        queue = AsyncMock()

        with patch(
            "src.smart_rag.engines.multi_agent.agentic_workflows.auto_agents._run_team_with_suggestions",
            new_callable=AsyncMock,
        ):
            await handle_no_agents_workflow(team, request, queue)

        team._message_helper._send_suggestions.assert_awaited()


class TestManualAgentsWorkflow:
    @pytest.mark.asyncio
    async def test_run_provided_team_uses_current_signature(self):
        team = _mock_team()
        request = _team_request("manual", agents=[_worker_agent()])
        queue = AsyncMock()

        await _run_provided_agent_team(
            team, request, "manager prompt", request.session_id, 0.2, False, queue
        )

        team.run_agent_team.assert_awaited_once_with(
            request.message,
            "manager prompt",
            request.session_id,
            False,
            q=queue,
            manager_temperature=0.2,
            image_input=request.image_input,
            original_agents=request.agents,
        )

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
                team, request, AsyncMock()
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
                team, request, AsyncMock()
            )

        assert any(t.get("name") == "deep_search" for t in worker.tools)


class TestSingleAgentWorkflow:
    def bind_owned_request(self, request, service):
        from src.root_runtime.background_sessions import BackgroundWriteGrant
        from src.root_runtime.contracts import ExecutionRole, ExecutionScopeV1
        service.grant = BackgroundWriteGrant('a' * 24, 'b' * 24, 'c' * 24, 0, 'owner', 1,
            'background_' + 'a' * 24, 'd' * 64, native_owner='native-process')
        request.user_id = service.grant.actor_id
        request.session_id = service.grant.session_id
        request.execution_scope = ExecutionScopeV1(role=ExecutionRole.LIBRARY_WORKER, execution_id='a' * 24,
            parent_execution_id='e' * 24, depth=1, expected_fence='1', native_session_id=request.session_id)
        request.session_service = service

    @pytest.mark.asyncio
    async def test_owned_workflow_checks_authority_before_preparing_any_agent(self):
        from src.root_runtime.background_sessions import FencedBackgroundSessionService, BackgroundOwnershipError
        request = _team_request('mono', agents=[_worker_agent()])
        service = MagicMock(spec=FencedBackgroundSessionService)
        service.validate_owner = AsyncMock(side_effect=BackgroundOwnershipError('lost owner'))
        self.bind_owned_request(request, service)
        assert 'session_service' not in request.model_dump()
        team = _mock_team()
        with pytest.raises(BackgroundOwnershipError, match='lost owner'):
            await handle_single_agent_workflow(team, request, AsyncMock())
        team.agent_helper._prepare_agent_data.assert_not_called()
        team.run_single_agent.assert_not_awaited()
        team._message_helper._send_error_message.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_owned_workflow_forwards_storage_and_propagates_failure_to_supervisor(self):
        from src.root_runtime.background_sessions import FencedBackgroundSessionService
        request = _team_request('mono', agents=[_worker_agent()])
        service = MagicMock(spec=FencedBackgroundSessionService)
        service.validate_owner = AsyncMock()
        self.bind_owned_request(request, service)
        team = _mock_team()
        with patch('src.smart_rag.engines.multi_agent.agentic_workflows.single_agent.DocumentHelpers') as docs:
            docs.agent_to_dict.return_value = {'agent_type': 'worker'}
            docs.merge_user_request_brain_documents_into_agents.side_effect = lambda agents, _request: agents
            team.run_single_agent.side_effect = RuntimeError('native failure')
            with pytest.raises(RuntimeError, match='native failure'):
                await handle_single_agent_workflow(team, request, AsyncMock())
        assert team.run_single_agent.call_args.kwargs['session_service'] is service
        service.validate_owner.assert_awaited_once()
        team._message_helper._send_error_message.assert_not_awaited()

    @pytest.mark.asyncio
    @pytest.mark.parametrize('mismatch', ['actor', 'session', 'execution', 'fence'])
    async def test_owned_request_binding_is_rejected_before_team_factory(self, mismatch):
        from dataclasses import replace
        from src.root_runtime.background_sessions import FencedBackgroundSessionService
        from src.smart_rag.engines.multi_agent.workflow_processor import run_agent_team_logic
        request = _team_request('mono', agents=[_worker_agent()])
        service = MagicMock(spec=FencedBackgroundSessionService)
        service.validate_owner = AsyncMock()
        self.bind_owned_request(request, service)
        if mismatch == 'actor': request.user_id = 'wrong-actor'
        elif mismatch == 'session': request.session_id = 'wrong-session'
        elif mismatch == 'execution': request.execution_scope = replace(request.execution_scope, execution_id='f' * 24)
        else: request.execution_scope = replace(request.execution_scope, expected_fence='2')
        with patch('src.smart_rag.engines.multi_agent.workflow_processor.initialize_dependencies') as factory:
            with pytest.raises(ValueError, match='owned native authority'):
                await run_agent_team_logic(request, AsyncMock())
        factory.assert_not_called()
        service.validate_owner.assert_not_awaited()

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
            await handle_single_agent_workflow(team, request, AsyncMock())

        mock_run.assert_awaited_once_with(
            user_prompt=request.message,
            session_id=request.session_id,
            q=ANY,
            image_input=request.image_input,
            task_summary="Profitability",
            delegation_tool=None,
            temporary_worker_tool=None,
            fanout_tool=None,
            delegation_instruction="",
            execution_scope=None,
            abort_signal=None,
            native_input_responses=None,
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
            await handle_single_agent_workflow(team, request, AsyncMock())

        team._message_helper._send_error_message.assert_awaited_once()
