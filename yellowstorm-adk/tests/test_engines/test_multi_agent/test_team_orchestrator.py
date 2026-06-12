"""Tests for AutoAgentGenerationTeam."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import asyncio

from src.smart_rag.engines.multi_agent.team_orchestrator import AutoAgentGenerationTeam
from src.smart_rag.infrastructure.processing import PromptProcessor


class TestAutoAgentGenerationTeam:
    """Test cases for AutoAgentGenerationTeam."""

    def test_init(self):
        """Test orchestrator initialization."""
        orchestrator = AutoAgentGenerationTeam()
        assert orchestrator is not None

    @pytest.mark.asyncio
    async def test_process_team_request_basic(self):
        """Test basic team request processing."""
        mock_config = MagicMock()
        mock_config.user_id = "user123"
        orchestrator = AutoAgentGenerationTeam(mock_config)

        mock_queue = AsyncMock()
        user_prompt = "Test user query"
        manager_prompt = "Manage the team"
        session_id = "session123"
        manager_memory = True

        with patch.object(orchestrator, 'agent_tools_manager') as mock_tools_manager, \
             patch.object(orchestrator, 'manager_factory') as mock_manager_factory, \
             patch.object(orchestrator, 'streaming_processor') as mock_streaming_processor, \
             patch.object(orchestrator, 'memory_service') as mock_memory_service:

            # Mock the tools manager
            mock_tools_manager.create_tools_from_all_agents.return_value = []

            # Mock the manager factory
            mock_manager_agent = MagicMock()
            mock_manager_factory.create_manager_agent.return_value = mock_manager_agent

            # Mock the streaming processor
            mock_streaming_processor.process_streaming_events = AsyncMock(return_value="Manager response")

            # Mock memory service
            mock_memory_service.initialize = AsyncMock()
            mock_memory_service.create_manager_context = AsyncMock(return_value="\nMemory context")
            mock_memory_service.save_manager_conversation = AsyncMock()

            # Mock DatabaseSessionService
            with patch('src.smart_rag.engines.multi_agent.team_orchestrator.DatabaseSessionService') as mock_db_session_class:
                mock_db_session = MagicMock()
                mock_db_session.get_session = AsyncMock(return_value=MagicMock())
                mock_db_session_class.return_value = mock_db_session

                result = await orchestrator.run_agent_team(user_prompt, manager_prompt, session_id, manager_memory, mock_queue)

                # run_agent_team should return None since responses are handled via queue
                assert result is None

    @pytest.mark.asyncio
    async def test_process_team_request_memory_disabled(self):
        """Test team request processing with memory disabled."""
        mock_config = MagicMock()
        mock_config.user_id = "user123"
        orchestrator = AutoAgentGenerationTeam(mock_config)

        mock_queue = AsyncMock()
        user_prompt = "Test user query"
        manager_prompt = "Manage the team"
        session_id = "session123"
        manager_memory = False

        with patch.object(orchestrator, 'agent_tools_manager') as mock_tools_manager, \
             patch.object(orchestrator, 'manager_factory') as mock_manager_factory, \
             patch.object(orchestrator, 'streaming_processor') as mock_streaming_processor, \
             patch.object(orchestrator, 'memory_service') as mock_memory_service:

            # Mock the tools manager
            mock_tools_manager.create_tools_from_all_agents.return_value = []

            # Mock the manager factory
            mock_manager_agent = MagicMock()
            mock_manager_factory.create_manager_agent.return_value = mock_manager_agent

            # Mock the streaming processor
            mock_streaming_processor.process_streaming_events = AsyncMock(return_value="Manager response")

            # Mock memory service
            mock_memory_service.initialize = AsyncMock()
            mock_memory_service.create_manager_context = AsyncMock(return_value="\nMemory context")
            mock_memory_service.save_manager_conversation = AsyncMock()

            # Mock DatabaseSessionService
            with patch('src.smart_rag.engines.multi_agent.team_orchestrator.DatabaseSessionService') as mock_db_session_class:
                mock_db_session = MagicMock()
                mock_db_session.get_session = AsyncMock(return_value=MagicMock())
                mock_db_session_class.return_value = mock_db_session

                result = await orchestrator.run_agent_team(user_prompt, manager_prompt, session_id, manager_memory, mock_queue)

                # run_agent_team should return None since responses are handled via queue
                assert result is None

                # Verify memory service was NOT initialized when manager_memory is False
                # Memory context operations were NOT used when manager_memory is False
                mock_memory_service.initialize.assert_not_called()
                mock_memory_service.create_manager_context.assert_not_called()
                mock_memory_service.save_manager_conversation.assert_not_called()

    @pytest.mark.asyncio
    async def test_create_agent_team(self):
        """Test creating an agent team."""
        mock_config = MagicMock()
        mock_config.vectorstore_name = "test_vectorstore"
        mock_config.workspace_names = ["brain1"]

        mock_prompt_processor = MagicMock()
        mock_llm_factory = MagicMock()

        # Mock the LLM instance properly
        mock_llm = MagicMock()
        mock_llm.__str__ = MagicMock(return_value="MockLLM")
        mock_llm_factory.create_parallel_tool_calls_llm.return_value = mock_llm
        mock_llm_factory.create_no_tool_calls_llm.return_value = mock_llm

        orchestrator = AutoAgentGenerationTeam(
            config=mock_config,
            prompt_processor=mock_prompt_processor,
            llm_factory=mock_llm_factory
        )

        team_config = MagicMock()

        # Create mock agent configs with proper attributes
        search_agent_config = MagicMock()
        search_agent_config.type = "search"
        search_agent_config.name = "SearchAgent"
        search_agent_config.prompt = "Search prompt"
        search_agent_config.brain_documents = []
        search_agent_config.brain_relations = {}
        search_agent_config.tools = [{"name": "search", "top_k": 5}]
        search_agent_config.vectorstore_name = "test_vectorstore"
        search_agent_config.workspace_names = ["brain1"]
        search_agent_config.chatbot_name = {"name": "test_bot"}

        report_agent_config = MagicMock()
        report_agent_config.type = "report"
        report_agent_config.name = "ReportAgent"

        team_config.agents = [search_agent_config, report_agent_config]
        team_config.manager_prompt = "Coordinate the team"

        # Patch build_tree at the module where _create_agent_team imports it
        with patch('src.smart_rag.agents.factories.base_factory.AgentFactory') as mock_factory_class, \
             patch('src.smart_rag.engines.multi_agent.team_orchestrator.build_tree') as mock_build_tree, \
             patch('src.smart_rag.agents.factories.base_factory.Agent') as mock_agent_class:

            mock_factory = MagicMock()
            mock_factory_class.return_value = mock_factory
            mock_build_tree.return_value = ([], {})

            # Mock prompt processor method
            mock_prompt_processor.extract_chatbot_name_and_clean_prompt.return_value = ("clean_prompt", {"name": "test_bot"})
            mock_prompt_processor.get_web_search_prompt.return_value = "web search prompt"

            # Mock agent creation
            mock_search_agent = MagicMock()
            mock_report_agent = MagicMock()
            mock_manager_agent = MagicMock()

            # Mock the Agent constructor
            mock_agent_class.return_value = mock_search_agent

            mock_factory.create_search_agent.return_value = (mock_search_agent, None, "search_instruction")
            mock_factory.create_report_writer_agent.return_value = mock_report_agent
            mock_factory.create_manager_agent.return_value = mock_manager_agent

            team = await orchestrator._create_agent_team(team_config,"session_123")

            assert team is not None
            assert len(team.agents) >= 2
            assert team.manager is not None

    @pytest.mark.asyncio
    async def test_execute_team_workflow_sequential(self):
        """Test executing team workflow in sequential mode."""
        orchestrator = AutoAgentGenerationTeam()

        mock_team = MagicMock()
        mock_team.workflow_mode = "sequential"
        mock_team.agents = [MagicMock(name="Agent1"), MagicMock(name="Agent2")]
        mock_team.manager = MagicMock(name="Manager")

        mock_request = MagicMock()
        mock_request.user_prompt = "Test task"
        mock_queue = AsyncMock()

        with patch.object(orchestrator, '_run_sequential_workflow') as mock_sequential:
            mock_sequential.return_value = "Sequential result"

            result = await orchestrator._execute_team_workflow(mock_team, mock_request, mock_queue)

            mock_sequential.assert_called_once_with(mock_team, mock_request, mock_queue)
            assert result == "Sequential result"

    @pytest.mark.asyncio
    async def test_execute_team_workflow_parallel(self):
        """Test executing team workflow in parallel mode."""
        orchestrator = AutoAgentGenerationTeam()

        mock_team = MagicMock()
        mock_team.workflow_mode = "parallel"
        mock_team.agents = [MagicMock(name="Agent1"), MagicMock(name="Agent2")]
        mock_team.manager = MagicMock(name="Manager")

        mock_request = MagicMock()
        mock_request.user_prompt = "Test task"
        mock_queue = AsyncMock()

        with patch.object(orchestrator, '_run_parallel_workflow') as mock_parallel:
            mock_parallel.return_value = "Parallel result"

            result = await orchestrator._execute_team_workflow(mock_team, mock_request, mock_queue)

            mock_parallel.assert_called_once_with(mock_team, mock_request, mock_queue)
            assert result == "Parallel result"

    @pytest.mark.asyncio
    async def test_run_sequential_workflow(self):
        """Test running sequential workflow."""
        orchestrator = AutoAgentGenerationTeam()

        # Create mock agents
        mock_agent1 = MagicMock()
        mock_agent1.name = "SearchAgent"
        mock_agent2 = MagicMock()
        mock_agent2.name = "ReportAgent"
        mock_manager = MagicMock()
        mock_manager.name = "Manager"

        mock_team = MagicMock()
        mock_team.agents = [mock_agent1, mock_agent2]
        mock_team.manager = mock_manager

        mock_request = MagicMock()
        mock_request.user_prompt = "Sequential task"
        mock_queue = AsyncMock()

        with patch.object(orchestrator, '_run_agent') as mock_run_agent:
            # Mock agent responses - _run_agent returns a 4-tuple (result, bool, dict, list)
            mock_run_agent.side_effect = [
                ("Agent1 result", False, {}, []),
                ("Agent2 result", False, {}, []),
                ("Manager final result", False, {}, [])
            ]

            result = await orchestrator._run_sequential_workflow(mock_team, mock_request, mock_queue)

            assert mock_run_agent.call_count == 3
            assert result == "Manager final result"

    @pytest.mark.asyncio
    async def test_run_parallel_workflow(self):
        """Test running parallel workflow."""
        orchestrator = AutoAgentGenerationTeam()

        # Create mock agents
        mock_agent1 = MagicMock()
        mock_agent1.name = "SearchAgent"
        mock_agent2 = MagicMock()
        mock_agent2.name = "AnalysisAgent"
        mock_manager = MagicMock()
        mock_manager.name = "Manager"

        mock_team = MagicMock()
        mock_team.agents = [mock_agent1, mock_agent2]
        mock_team.manager = mock_manager

        mock_request = MagicMock()
        mock_request.user_prompt = "Parallel task"
        mock_queue = AsyncMock()

        with patch.object(orchestrator, '_run_agent') as mock_run_agent:
            # Mock agent responses - _run_agent returns a 4-tuple (result, bool, dict, list)
            mock_run_agent.side_effect = [
                ("Agent1 result", False, {}, []),
                ("Agent2 result", False, {}, []),
                ("Manager synthesis", False, {}, [])
            ]

            result = await orchestrator._run_parallel_workflow(mock_team, mock_request, mock_queue)

            # Should run agents in parallel, then manager
            assert mock_run_agent.call_count == 3
            assert result == "Manager synthesis"

    @pytest.mark.asyncio
    async def test_run_agent(self):
        """Test running individual agent."""
        orchestrator = AutoAgentGenerationTeam()

        mock_agent = MagicMock()
        mock_agent.name = "TestAgent"

        mock_queue = AsyncMock()
        task = "Test task for agent"

        # _run_agent imports AgentRunner, MessageTransformer, and InMemorySessionService inline
        # We need to mock them where they get imported in team_orchestrator._run_agent
        mock_runner = MagicMock()
        mock_runner.run_agent_tool = AsyncMock(return_value=("Agent response", False, {}, []))

        mock_transformer = MagicMock()
        mock_session = MagicMock()

        with patch('src.smart_rag.agents.core.runner.AgentRunner', return_value=mock_runner), \
             patch('src.smart_rag.engines.multi_agent.team_orchestrator.MessageTransformer', return_value=mock_transformer), \
             patch('src.smart_rag.engines.multi_agent.team_orchestrator.InMemorySessionService', return_value=mock_session):

            result = await orchestrator._run_agent(mock_agent, task, mock_queue)

            mock_runner.run_agent_tool.assert_called_once()
            assert result == ("Agent response", False, {}, [])

    @pytest.mark.asyncio
    async def test_delegate_task_to_agent(self):
        """Test delegating specific task to specific agent."""
        orchestrator = AutoAgentGenerationTeam()

        mock_team = MagicMock()
        mock_search_agent = MagicMock()
        mock_search_agent.name = "SearchAgent"
        mock_search_agent.capabilities = ["document_search"]

        mock_team.agents = [mock_search_agent]

        task = "Search for documents about machine learning"
        task_type = "search"
        mock_queue = AsyncMock()

        with patch.object(orchestrator, '_run_agent') as mock_run_agent:
            mock_run_agent.return_value = ("Search results", False, {}, [])

            result = await orchestrator._delegate_task_to_agent(mock_team, task, task_type, mock_queue)

            mock_run_agent.assert_called_once_with(mock_search_agent, task, mock_queue)
            assert result == ("Search results", False, {}, [])

    def test_match_agent_to_task(self):
        """Test matching agents to tasks based on capabilities."""
        orchestrator = AutoAgentGenerationTeam()

        search_agent = MagicMock()
        search_agent.name = "SearchAgent"
        search_agent.capabilities = ["document_search", "web_search"]

        analysis_agent = MagicMock()
        analysis_agent.name = "AnalysisAgent"
        analysis_agent.capabilities = ["data_analysis", "reporting"]

        agents = [search_agent, analysis_agent]

        # Test search task
        search_task = "Find documents about Python"
        matched_agent = orchestrator._match_agent_to_task(agents, search_task, "search")
        assert matched_agent.name == "SearchAgent"

        # Test analysis task
        analysis_task = "Analyze the data trends"
        matched_agent = orchestrator._match_agent_to_task(agents, analysis_task, "analysis")
        assert matched_agent.name == "AnalysisAgent"

    @pytest.mark.asyncio
    async def test_coordinate_agent_communication(self):
        """Test coordinating communication between agents."""
        orchestrator = AutoAgentGenerationTeam()

        sender_agent = MagicMock()
        sender_agent.name = "SearchAgent"

        receiver_agent = MagicMock()
        receiver_agent.name = "AnalysisAgent"

        message = "Here are the search results for analysis"
        context = {"task_id": "task123", "priority": "high"}

        with patch.object(orchestrator, '_format_inter_agent_message') as mock_format:
            mock_format.return_value = "Formatted message"

            result = await orchestrator._coordinate_agent_communication(
                sender_agent, receiver_agent, message, context
            )

            mock_format.assert_called_once_with(sender_agent, receiver_agent, message, context)
            assert result == "Formatted message"

    def test_validate_team_configuration(self):
        """Test validating team configuration."""
        orchestrator = AutoAgentGenerationTeam()

        # Valid configuration
        valid_config = MagicMock()
        valid_config.agents = [MagicMock(name="Agent1"), MagicMock(name="Agent2")]
        valid_config.manager_prompt = "Coordinate the team"
        valid_config.workflow_mode = "sequential"

        assert orchestrator._validate_team_configuration(valid_config) is True

        # Invalid configuration - no agents
        invalid_config = MagicMock()
        invalid_config.agents = []
        invalid_config.manager_prompt = "Coordinate the team"

        assert orchestrator._validate_team_configuration(invalid_config) is False

    @pytest.mark.asyncio
    async def test_handle_workflow_error(self):
        """Test handling workflow errors."""
        orchestrator = AutoAgentGenerationTeam()

        error = Exception("Agent communication failed")
        context = {
            "team_id": "team123",
            "current_agent": "SearchAgent",
            "task": "Search documents"
        }

        mock_queue = AsyncMock()

        with patch.object(orchestrator, '_create_error_response') as mock_error_response:
            mock_error_response.return_value = "Error handled gracefully"

            result = await orchestrator._handle_workflow_error(error, context, mock_queue)

            mock_error_response.assert_called_once_with(error, context)
            assert result == "Error handled gracefully"

    def test_get_team_performance_metrics(self):
        """Test getting team performance metrics."""
        orchestrator = AutoAgentGenerationTeam()

        execution_log = [
            {"agent": "SearchAgent", "duration": 2.5, "status": "success"},
            {"agent": "AnalysisAgent", "duration": 3.0, "status": "success"},
            {"agent": "Manager", "duration": 1.0, "status": "success"}
        ]

        metrics = orchestrator._get_team_performance_metrics(execution_log)

        assert metrics["total_duration"] == 6.5
        assert metrics["agent_count"] == 3
        assert metrics["success_rate"] == 1.0
        assert "average_duration" in metrics

    @pytest.mark.asyncio
    async def test_optimize_team_workflow(self):
        """Test optimizing team workflow based on performance."""
        orchestrator = AutoAgentGenerationTeam()

        team_config = MagicMock()
        team_config.workflow_mode = "sequential"

        performance_data = {
            "average_duration": 10.0,
            "bottleneck_agent": "AnalysisAgent",
            "success_rate": 0.85
        }

        optimized_config = await orchestrator._optimize_team_workflow(team_config, performance_data)

        assert optimized_config is not None
        # Optimization logic would modify the configuration

    @pytest.mark.asyncio
    async def test_scale_team_dynamically(self):
        """Test dynamically scaling team based on workload."""
        orchestrator = AutoAgentGenerationTeam()

        current_team = MagicMock()
        current_team.agents = [MagicMock(name="Agent1")]

        workload_metrics = {
            "queue_length": 50,
            "average_response_time": 15.0,
            "cpu_utilization": 0.9
        }

        with patch.object(orchestrator, '_add_agent_to_team') as mock_add_agent:
            scaled_team = await orchestrator._scale_team_dynamically(current_team, workload_metrics)

            # Should add agents when workload is high
            mock_add_agent.assert_called()

    def test_format_team_response(self):
        """Test formatting final team response."""
        orchestrator = AutoAgentGenerationTeam()

        agent_responses = [
            {"agent": "SearchAgent", "response": "Found 10 documents"},
            {"agent": "AnalysisAgent", "response": "Analysis complete"},
            {"agent": "Manager", "response": "Final synthesis"}
        ]

        formatted = orchestrator._format_team_response(agent_responses)

        assert "SearchAgent" in formatted
        assert "AnalysisAgent" in formatted
        assert "Manager" in formatted
        assert "Found 10 documents" in formatted

    @pytest.mark.asyncio
    async def test_monitor_team_health(self):
        """Test monitoring team health during execution."""
        orchestrator = AutoAgentGenerationTeam()

        team = MagicMock()
        team.agents = [MagicMock(name="Agent1"), MagicMock(name="Agent2")]

        health_status = await orchestrator._monitor_team_health(team)

        assert "agent_count" in health_status
        assert "overall_status" in health_status
        assert health_status["agent_count"] == 2