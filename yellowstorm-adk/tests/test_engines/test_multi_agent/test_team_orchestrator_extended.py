"""Extended unit tests for AutoAgentGenerationTeam."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.smart_rag.engines.multi_agent.team_orchestrator import AutoAgentGenerationTeam


def _orchestrator():
    config = MagicMock()
    config.user_id = "user-1"
    config.session_id = "sess-1"
    config.brain_ids = ["b1"]
    config.vectorstore_name = "vs"
    config.chatbot_name = {"provider": "gpt-4o"}
    team = AutoAgentGenerationTeam(
        config=config,
        prompt_processor=MagicMock(),
        llm_factory=MagicMock(),
        agent_factory=MagicMock(),
        agent_runner=MagicMock(),
        streaming_formatter=MagicMock(),
        event_extractor=MagicMock(),
        chatbot_name={"provider": "gpt-4o"},
    )
    team.agent_repository = MagicMock()
    team.manager_factory = MagicMock()
    team.agent_tools_manager = MagicMock()
    team.streaming_processor = MagicMock()
    return team


class TestTeamOrchestratorExtended:
    def test_get_agent_id_by_name_delegates(self):
        team = _orchestrator()
        team.agent_repository.get_agent_id_by_name.return_value = "agent-1"
        assert team.get_agent_id_by_name("SearchAgent") == "agent-1"

    def test_has_search_and_code_interpreter_flags(self):
        team = _orchestrator()
        team.agent_repository.has_search_agents.return_value = True
        team.agent_repository.has_code_interpreter.return_value = False
        assert team.has_search_agents() is True
        assert team.has_code_interpreter() is False

    def test_get_document_tree_info(self):
        team = _orchestrator()
        team.manager_factory._get_document_tree_info.return_value = "<tree/>"
        assert team.get_document_tree_info([], {}) == "<tree/>"

    @pytest.mark.asyncio
    async def test_get_agent_suggestions_delegates(self):
        team = _orchestrator()
        team.suggestion_generator.generate_suggestions = AsyncMock(
            return_value=({"suggestions": [{"name": "A"}], "available_agent_ids": []}, {})
        )
        result = await team.get_agent_suggestions("prompt", "query", "sess", [], [], {}, [])
        assert result == [{"name": "A"}]

    @pytest.mark.asyncio
    async def test_run_agent_team_success(self):
        team = _orchestrator()
        team.agent_tools_manager.create_tools_from_all_agents.return_value = []
        team.manager_factory.create_manager_agent.return_value = MagicMock(name="Manager")
        team.streaming_processor.process_streaming_events = AsyncMock(return_value="done")
        team.document_helper._get_consolidated_document_tree_info_for_manager = MagicMock(return_value="")
        queue = AsyncMock()
        with patch(
            "src.smart_rag.engines.multi_agent.team_orchestrator.get_database_session_service"
        ) as mock_db, patch(
            "src.smart_rag.engines.multi_agent.team_orchestrator.get_adk_runner"
        ) as mock_runner, patch(
            "src.smart_rag.infrastructure.session.citation_manager.get_citation_manager",
            new=AsyncMock(return_value=MagicMock()),
        ):
            mock_db.return_value.return_value.get_session = AsyncMock(return_value=MagicMock())
            mock_runner.return_value = MagicMock()
            result = await team.run_agent_team("user", "manager", "sess-1", False, queue)
        assert result is None
        team.streaming_processor.process_streaming_events.assert_awaited_once()

    def test_inline_chart_guidance_present(self):
        team = _orchestrator()
        assert "render_chart" in team.INLINE_CHART_GUIDANCE

    @pytest.mark.asyncio
    async def test_create_agent_team_report_agent_branch(self):
        team = _orchestrator()
        report_config = MagicMock()
        report_config.type = "report"
        report_config.name = "ReportAgent"
        team_config = MagicMock()
        team_config.agents = [report_config]
        team_config.manager_prompt = "coordinate"
        with patch(
            "src.smart_rag.agents.factories.base_factory.AgentFactory"
        ) as mock_factory_cls:
            mock_factory = MagicMock()
            mock_factory.create_report_writer_agent.return_value = MagicMock()
            mock_factory.create_manager_agent.return_value = MagicMock()
            mock_factory_cls.return_value = mock_factory
            created = await team._create_agent_team(team_config, "sess-1")
        assert created.manager is not None
        assert len(created.agents) == 1

    @pytest.mark.asyncio
    async def test_execute_team_workflow_sequential(self):
        team = _orchestrator()
        mock_team = MagicMock()
        mock_team.workflow_mode = "sequential"
        mock_team.agents = [MagicMock(name="agent")]
        mock_team.manager = MagicMock(name="manager")
        team._run_agent = AsyncMock(side_effect=[("a", None, None, None), ("final", None, None, None)])
        request = SimpleNamespace(user_prompt="task")
        result = await team._execute_team_workflow(mock_team, request, AsyncMock())
        assert result == "final"

    @pytest.mark.asyncio
    async def test_execute_team_workflow_parallel(self):
        team = _orchestrator()
        mock_team = MagicMock()
        mock_team.workflow_mode = "parallel"
        mock_team.agents = [MagicMock()]
        mock_team.manager = MagicMock()
        team._run_agent = AsyncMock(return_value=("ok", None, None, None))
        request = SimpleNamespace(user_prompt="task")
        result = await team._execute_team_workflow(mock_team, request, AsyncMock())
        assert result == "ok"

    @pytest.mark.asyncio
    async def test_execute_team_workflow_unknown_mode(self):
        team = _orchestrator()
        mock_team = MagicMock()
        mock_team.workflow_mode = "custom"
        result = await team._execute_team_workflow(mock_team, SimpleNamespace(), AsyncMock())
        assert result == "Workflow completed"

    def test_validate_team_configuration(self):
        team = _orchestrator()
        valid = MagicMock()
        valid.agents = [MagicMock()]
        valid.manager_prompt = "go"
        invalid = MagicMock()
        invalid.agents = []
        invalid.manager_prompt = ""
        assert team._validate_team_configuration(valid) is True
        assert team._validate_team_configuration(invalid) is False

    def test_match_agent_to_task_by_name(self):
        team = _orchestrator()
        search_agent = MagicMock()
        search_agent.name = "search_specialist"
        search_agent.capabilities = []
        matched = team._match_agent_to_task([search_agent], "find docs", "search")
        assert matched is search_agent

    def test_get_team_performance_metrics(self):
        team = _orchestrator()
        metrics = team._get_team_performance_metrics(
            [
                {"duration": 2, "status": "success"},
                {"duration": 3, "status": "failed"},
            ]
        )
        assert metrics["total_duration"] == 5
        assert metrics["success_rate"] == 0.5

    def test_create_error_response(self):
        team = _orchestrator()
        assert "boom" in team._create_error_response(ValueError("boom"), {})
