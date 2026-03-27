"""Unit tests for playbook step executor."""

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock, call
from google.genai import types

from src.schema.playbook import RunPlaybookStepRequest
from src.schema.chatbot_schema import AgentSuggestion
from src.smart_rag.playbook_dir.execute_step import PlaybookStepExecutor, execute_playbook_step


@pytest.fixture
def mock_agent_suggestion():
    """Mock AgentSuggestion for testing."""
    return AgentSuggestion(
        id="agent-123",
        name="Test Agent",
        description="A test agent",
        prompt="You are a helpful agent",
        tools=[{"name": "search"}, {"name": "calculator"}],
        chatbot_name={"provider": "gpt-4"},
        brain_ids=["brain-1"],
        save_memory=False,
        agent_params={"temperature": 0.7}
    )


@pytest.fixture
def mock_manager_suggestion():
    """Mock Manager AgentSuggestion for testing."""
    return AgentSuggestion(
        id="manager-123",
        name="Manager Agent",
        description="A manager agent",
        prompt="You are a manager",
        chatbot_name={"provider": "gpt-4"},
        brain_ids=[],
        agent_type="manager"
    )


@pytest.fixture
def mock_playbook_request(mock_agent_suggestion, mock_manager_suggestion):
    """Mock RunPlaybookStepRequest for testing."""
    return RunPlaybookStepRequest(
        messageId="msg-12345",
        userId="user-123",
        taskId="task-456",
        taskDescription="Complete this task",
        task_metadata={"priority": "high"},
        result="Previous result",
        order=1,
        agent=mock_agent_suggestion,
        manager_agent=mock_manager_suggestion,
        call_id="call-789",
        vectorstore_name="test-vectorstore"
    )


@pytest.fixture
def executor():
    """Create a PlaybookStepExecutor instance for testing."""
    # Create a real instance with mocked dependencies
    with patch('src.smart_rag.playbook_dir.execute_step.PromptProcessor'), \
         patch('src.smart_rag.playbook_dir.execute_step.LLMFactory'), \
         patch('src.smart_rag.playbook_dir.execute_step.AgentFactory'), \
         patch('src.smart_rag.playbook_dir.execute_step.StreamingFormatter'), \
         patch('src.smart_rag.playbook_dir.execute_step.AgentHelper'), \
         patch('src.smart_rag.playbook_dir.execute_step.AgentRepository'), \
         patch('src.smart_rag.playbook_dir.execute_step.ToolDescriptionProvider'), \
         patch('src.smart_rag.playbook_dir.execute_step.EventExtractor'), \
         patch('src.smart_rag.playbook_dir.execute_step.MessageTransformer'), \
         patch('src.smart_rag.playbook_dir.execute_step.AgentRunner'):

        executor = PlaybookStepExecutor()
        yield executor


class TestPlaybookStepExecutorInit:
    """Test suite for PlaybookStepExecutor initialization."""

    def test_initialization(self, executor):
        """Test that PlaybookStepExecutor initializes correctly."""
        assert executor is not None
        assert hasattr(executor, 'prompt_processor')
        assert hasattr(executor, 'llm_factory')
        assert hasattr(executor, 'agent_factory')
        assert hasattr(executor, 'streaming_formatter')
        assert hasattr(executor, 'run_config')
        assert hasattr(executor, 'agent_helper')
        assert hasattr(executor, 'agent_repository')
        assert hasattr(executor, 'tool_description_provider')
        assert hasattr(executor, 'event_extractor')
        assert hasattr(executor, 'message_transformer')
        assert hasattr(executor, 'agent_runner')


class TestCheckSearchWebTool:
    """Test suite for _check_search_web_tool method."""

    def test_check_search_web_tool_found(self, executor, mock_playbook_request):
        """Test detection of search_web tool when present."""
        mock_playbook_request.agent.tools = [{"name": "search_web"}, {"name": "calculator"}]
        result = executor._check_search_web_tool(mock_playbook_request)
        assert result is True

    def test_check_search_web_tool_not_found(self, executor, mock_playbook_request):
        """Test when search_web tool is not present."""
        mock_playbook_request.agent.tools = [{"name": "calculator"}, {"name": "search"}]
        result = executor._check_search_web_tool(mock_playbook_request)
        assert result is False

    def test_check_search_web_tool_no_tools(self, executor, mock_playbook_request):
        """Test when agent has no tools."""
        mock_playbook_request.agent.tools = None
        result = executor._check_search_web_tool(mock_playbook_request)
        assert result is False

    def test_check_search_web_tool_case_insensitive(self, executor, mock_playbook_request):
        """Test that search_web detection is case insensitive."""
        mock_playbook_request.agent.tools = [{"name": "SEARCH_WEB"}]
        result = executor._check_search_web_tool(mock_playbook_request)
        assert result is True

    def test_check_search_web_tool_invalid_config(self, executor, mock_playbook_request):
        """Test handling of invalid tool configuration."""
        mock_playbook_request.agent.tools = [None, {"invalid": "config"}]
        result = executor._check_search_web_tool(mock_playbook_request)
        assert result is False


class TestCreateConfigObject:
    """Test suite for _create_config_object method."""

    def test_create_config_object_valid(self, executor, mock_playbook_request):
        """Test creating a config object with valid data."""
        session_id = "session-123"
        config = executor._create_config_object(mock_playbook_request, session_id)

        assert config.session_id == session_id
        assert config.user_id == mock_playbook_request.userId
        assert config.chatbot_name == "gpt-4"
        assert config.brain_ids == mock_playbook_request.agent.brain_ids
        assert config.vectorstore_name == mock_playbook_request.vectorstore_name

    def test_create_config_object_chatbot_name_dict(self, executor, mock_playbook_request):
        """Test creating config when chatbot_name is a dict with provider."""
        mock_playbook_request.agent.chatbot_name = {"provider": "gpt-3.5-turbo"}
        config = executor._create_config_object(mock_playbook_request, "session-123")
        assert config.chatbot_name == "gpt-3.5-turbo"

    def test_create_config_object_chatbot_name_none(self, executor, mock_playbook_request):
        """Test creating config when chatbot_name is None (uses default)."""
        mock_playbook_request.agent.chatbot_name = None
        config = executor._create_config_object(mock_playbook_request, "session-123")
        assert config.chatbot_name == "gpt-4"  # DEFAULT_MODEL


class TestConvertRequestToAgentConfig:
    """Test suite for _convert_request_to_agent_config method."""

    def test_convert_request_to_agent_config_basic(self, executor, mock_playbook_request):
        """Test converting request to agent config with basic tools."""
        # Set available_tools so tools can be resolved
        mock_playbook_request.available_tools = [
            {"name": "search", "attributes": [{"name": "top_k", "value": 3}]},
            {"name": "calculator", "attributes": []}
        ]
        config = executor._convert_request_to_agent_config(mock_playbook_request)

        assert config["name"] == mock_playbook_request.agent.name
        assert config["description"] == mock_playbook_request.agent.description
        assert config["prompt"] == mock_playbook_request.agent.prompt
        assert config["brain_ids"] == mock_playbook_request.agent.brain_ids
        # chatbot_name is now returned as a dict (not a string)
        assert config["chatbot_name"] == {"provider": "gpt-4"}
        assert config["vectorstore_name"] == mock_playbook_request.vectorstore_name
        assert config["html"] == mock_playbook_request.agent.html
        assert config["save_memory"] == mock_playbook_request.agent.save_memory

    def test_convert_request_with_calculator_tool(self, executor, mock_playbook_request):
        """Test that calculator tool is converted correctly."""
        mock_playbook_request.agent.tools = [{"name": "calculator"}]
        mock_playbook_request.available_tools = [{"name": "calculator", "attributes": []}]
        config = executor._convert_request_to_agent_config(mock_playbook_request)
        tool_names = [t["name"] if isinstance(t, dict) else t for t in config["tools"]]
        assert "calculator" in tool_names

    def test_convert_request_with_search_web_tool(self, executor, mock_playbook_request):
        """Test that search_web tool is converted correctly."""
        mock_playbook_request.agent.tools = [{"name": "search_web"}]
        mock_playbook_request.available_tools = [{"name": "search_web", "attributes": []}]
        config = executor._convert_request_to_agent_config(mock_playbook_request)
        tool_names = [t["name"] if isinstance(t, dict) else t for t in config["tools"]]
        assert "search_web" in tool_names

    def test_convert_request_with_search_tool(self, executor, mock_playbook_request):
        """Test that search tool is converted to dict format with attributes from available_tools."""
        mock_playbook_request.agent.tools = [{"name": "search"}]
        mock_playbook_request.available_tools = [
            {"name": "search", "attributes": [{"name": "top_k", "value": 3}]}
        ]
        config = executor._convert_request_to_agent_config(mock_playbook_request)
        # Should create a dict config for search tool with attributes from available_tools
        search_tools = [t for t in config["tools"] if isinstance(t, dict) and t.get("name") == "search"]
        assert len(search_tools) == 1
        assert search_tools[0]["top_k"] == 3

    def test_convert_request_agent_params_temperature(self, executor, mock_playbook_request):
        """Test that agent temperature parameter is extracted correctly."""
        mock_playbook_request.agent.agent_params = {"temperature": 0.8}
        mock_playbook_request.available_tools = [
            {"name": "search", "attributes": []},
            {"name": "calculator", "attributes": []}
        ]
        config = executor._convert_request_to_agent_config(mock_playbook_request)
        assert config["agent_params"]["temperature"] == 0.8

    def test_convert_request_agent_params_missing(self, executor, mock_playbook_request):
        """Test default temperature when agent_params is missing."""
        mock_playbook_request.agent.agent_params = None
        mock_playbook_request.available_tools = [
            {"name": "search", "attributes": []},
            {"name": "calculator", "attributes": []}
        ]
        config = executor._convert_request_to_agent_config(mock_playbook_request)
        # When agent_params is None, agent_params is empty dict {}
        assert config["agent_params"] == {}


class TestFilterEventsUpToCallId:
    """Test suite for _filter_events_up_to_call_id method."""

    def test_filter_events_up_to_call_id_found(self, executor):
        """Test filtering events when call_id is found."""
        # Create mock events with function_call
        event1 = MagicMock()
        event1.content.parts = [MagicMock()]
        event1.content.parts[0].function_call.id = "call-1"

        event2 = MagicMock()
        event2.content.parts = [MagicMock()]
        event2.content.parts[0].function_call.id = "call-2"

        event3 = MagicMock()
        event3.content.parts = [MagicMock()]
        event3.content.parts[0].function_call.id = "call-3"

        events = [event1, event2, event3]
        filtered = executor._filter_events_up_to_call_id(events, "call-2")

        # Should keep events up to and including call-2
        assert len(filtered) == 2
        assert filtered == [event1, event2]

    def test_filter_events_call_id_not_found(self, executor):
        """Test filtering when call_id is not found returns all events."""
        event1 = MagicMock()
        event1.content.parts = [MagicMock()]
        event1.content.parts[0].function_call.id = "call-1"

        events = [event1]
        filtered = executor._filter_events_up_to_call_id(events, "call-nonexistent")

        # Should return all events when target not found
        assert len(filtered) == 1
        assert filtered == events

    def test_filter_events_with_function_response(self, executor):
        """Test filtering events with function_response."""
        event1 = MagicMock()
        event1.content.parts = [MagicMock()]
        event1.content.parts[0].function_response.id = "call-1"
        del event1.content.parts[0].function_call

        event2 = MagicMock()
        event2.content.parts = [MagicMock()]
        event2.content.parts[0].function_response.id = "call-2"
        del event2.content.parts[0].function_call

        events = [event1, event2]
        filtered = executor._filter_events_up_to_call_id(events, "call-1")

        assert len(filtered) == 1
        assert filtered == [event1]


class TestModifyEventsByCallId:
    """Test suite for _modify_events_by_call_id method."""

    def test_modify_events_function_call(self, executor):
        """Test modifying function_call events."""
        event = MagicMock()
        event.content.parts = [MagicMock()]
        event.content.parts[0].function_call.id = "call-123"
        event.content.parts[0].function_call.args = {
            "task_description": "Old description"
        }
        del event.content.parts[0].function_response

        events = [event]
        modified_count = executor._modify_events_by_call_id(
            events,
            "call-123",
            "New description",
            "New result"
        )

        assert modified_count == 1
        assert event.content.parts[0].function_call.args["task_description"] == "New description"

    def test_modify_events_function_response(self, executor):
        """Test modifying function_response events."""
        event = MagicMock()
        event.content.parts = [MagicMock()]
        event.content.parts[0].function_response.id = "call-123"
        event.content.parts[0].function_response.response = {
            "result": "Old result"
        }
        del event.content.parts[0].function_call

        events = [event]
        modified_count = executor._modify_events_by_call_id(
            events,
            "call-123",
            "New description",
            "New result"
        )

        assert modified_count == 1
        assert event.content.parts[0].function_response.response["result"] == "New result"

    def test_modify_events_no_matching_call_id(self, executor):
        """Test that no events are modified when call_id doesn't match."""
        event = MagicMock()
        event.content.parts = [MagicMock()]
        event.content.parts[0].function_call.id = "call-999"
        event.content.parts[0].function_call.args = {
            "task_description": "Original"
        }

        events = [event]
        modified_count = executor._modify_events_by_call_id(
            events,
            "call-123",
            "New description",
            "New result"
        )

        assert modified_count == 0
        assert event.content.parts[0].function_call.args["task_description"] == "Original"


class TestRetrieveSessionEvents:
    """Test suite for _retrieve_session_events method."""

    @pytest.mark.asyncio
    async def test_retrieve_session_events_success(self, executor):
        """Test successful retrieval of session events."""
        with patch('src.smart_rag.playbook_dir.execute_step.DatabaseSessionService') as MockSessionService:

            # Setup mocks
            mock_session_service = MagicMock()
            mock_session = MagicMock()
            mock_session.events = ["event1", "event2", "event3"]

            MockSessionService.return_value = mock_session_service
            mock_session_service.get_session = AsyncMock(return_value=mock_session)

            events = await executor._retrieve_session_events("session-123", "user-123")

            assert len(events) == 3
            assert events == ["event1", "event2", "event3"]

    @pytest.mark.asyncio
    async def test_retrieve_session_events_empty_session_id(self, executor):
        """Test that empty session_id raises ValueError."""
        with pytest.raises(ValueError, match="session_id cannot be empty"):
            await executor._retrieve_session_events("", "user-123")

    @pytest.mark.asyncio
    async def test_retrieve_session_events_empty_user_id(self, executor):
        """Test that empty user_id raises ValueError."""
        with pytest.raises(ValueError, match="user_id cannot be empty"):
            await executor._retrieve_session_events("session-123", "")

    @pytest.mark.asyncio
    async def test_retrieve_session_events_not_found(self, executor):
        """Test that ValueError is raised when session not found."""
        with patch('src.smart_rag.playbook_dir.execute_step.DatabaseSessionService') as MockSessionService:

            mock_session_service = MagicMock()
            mock_session_service.get_session = AsyncMock(return_value=None)
            MockSessionService.return_value = mock_session_service

            with pytest.raises(ValueError, match="Session not found"):
                await executor._retrieve_session_events("session-123", "user-123")

    @pytest.mark.asyncio
    async def test_retrieve_session_events_connection_error(self, executor):
        """Test handling of database connection errors."""
        from sqlalchemy.exc import SQLAlchemyError

        with patch('src.smart_rag.playbook_dir.execute_step.DatabaseSessionService') as MockSessionService:
            mock_session_service = MagicMock()
            mock_session_service.get_session = AsyncMock(side_effect=SQLAlchemyError("Connection failed"))
            MockSessionService.return_value = mock_session_service

            with pytest.raises(ConnectionError, match="Failed to query session"):
                await executor._retrieve_session_events("session-123", "user-123")


class TestReinjectEventsToDatabase:
    """Test suite for _reinject_events_to_database method."""

    @pytest.mark.asyncio
    async def test_reinject_events_success(self, executor):
        """Test successful reinjection of events."""
        with patch('src.smart_rag.playbook_dir.execute_step.DatabaseSessionService') as MockSessionService:

            mock_session_service = MagicMock()
            mock_session = MagicMock()

            MockSessionService.return_value = mock_session_service
            mock_session_service.create_session = AsyncMock(return_value=mock_session)
            mock_session_service.append_event = AsyncMock()

            mock_agent = MagicMock()
            mock_agent.instruction = "Test instruction"
            mock_agent.name = "Test Agent"

            events = ["event1", "event2", "event3"]

            await executor._reinject_events_to_database(
                events,
                "new-session-123",
                "user-123",
                mock_agent
            )

            # Verify session creation
            mock_session_service.create_session.assert_called_once()
            # Verify all events were appended
            assert mock_session_service.append_event.call_count == 3

    @pytest.mark.asyncio
    async def test_reinject_events_empty_list(self, executor):
        """Test that empty events list raises ValueError."""
        mock_agent = MagicMock()

        with pytest.raises(ValueError, match="Cannot inject empty events list"):
            await executor._reinject_events_to_database(
                [],
                "session-123",
                "user-123",
                mock_agent
            )

    @pytest.mark.asyncio
    async def test_reinject_events_invalid_session_id(self, executor):
        """Test that invalid session_id raises ValueError."""
        mock_agent = MagicMock()
        events = ["event1"]

        with pytest.raises(ValueError, match="new_session_id cannot be empty"):
            await executor._reinject_events_to_database(
                events,
                "",
                "user-123",
                mock_agent
            )

    @pytest.mark.asyncio
    async def test_reinject_events_high_failure_rate(self, executor):
        """Test handling when too many events fail to inject."""
        from sqlalchemy.exc import SQLAlchemyError

        with patch('src.smart_rag.playbook_dir.execute_step.DatabaseSessionService') as MockSessionService:

            mock_session_service = MagicMock()
            mock_session = MagicMock()

            MockSessionService.return_value = mock_session_service
            mock_session_service.create_session = AsyncMock(return_value=mock_session)
            # Make append_event fail for most events
            mock_session_service.append_event = AsyncMock(side_effect=SQLAlchemyError("Injection failed"))

            mock_agent = MagicMock()
            mock_agent.instruction = "Test"
            mock_agent.name = "Agent"

            events = ["event1", "event2", "event3", "event4"]

            with pytest.raises(RuntimeError, match="Too many events failed to inject"):
                await executor._reinject_events_to_database(
                    events,
                    "session-123",
                    "user-123",
                    mock_agent
                )


class TestSendErrorMessage:
    """Test suite for _send_error_message method."""

    @pytest.mark.asyncio
    async def test_send_error_message_success(self, executor):
        """Test successful error message sending."""
        queue = asyncio.Queue()

        await executor._send_error_message(
            queue,
            "session-123",
            "Test error message"
        )

        # Should have 3 items: formatted error, final error, completion signal
        assert queue.qsize() == 3

        # Get items from queue
        formatted_error = await queue.get()
        final_error = await queue.get()
        completion = await queue.get()

        # Verify that formatted error was returned from streaming_formatter
        # The exact format depends on the mock, just verify it's not None
        assert formatted_error is not None

        # Verify final error structure
        assert final_error["error"] == "Test error message"
        assert final_error["success"] is False
        assert final_error["session_id"] == "session-123"

        # Verify completion signal
        assert completion is None


class TestExecuteStepOnly:
    """Test suite for execute_step_only method."""

    @pytest.mark.asyncio
    async def test_execute_step_only_success(self, executor, mock_playbook_request):
        """Test successful step execution without manager."""
        with patch('src.smart_rag.playbook_dir.execute_step.AgentDelegationFactory') as MockFactory, \
             patch('src.smart_rag.playbook_dir.execute_step.langfuse_client'):

            # Setup mocks
            mock_delegation_factory = MagicMock()
            mock_agent = MagicMock()
            mock_agent.name = "Test Agent"
            mock_toolkit = MagicMock()

            mock_delegation_factory._create_agent_with_error_handling = AsyncMock(
                return_value=(mock_agent, mock_toolkit)
            )
            mock_delegation_factory._execute_agent_with_error_handling = AsyncMock(
                return_value="Step execution result"
            )

            MockFactory.return_value = mock_delegation_factory

            queue = asyncio.Queue()
            result = await executor.execute_step_only(mock_playbook_request, queue)

            assert result["success"] is True
            assert result["agent"] == mock_agent
            assert result["result"] == "Step execution result"

    @pytest.mark.asyncio
    async def test_execute_step_only_agent_creation_failure(self, executor, mock_playbook_request):
        """Test step execution when agent creation fails."""
        with patch('src.smart_rag.playbook_dir.execute_step.AgentDelegationFactory') as MockFactory, \
             patch('src.smart_rag.playbook_dir.execute_step.langfuse_client'):

            mock_delegation_factory = MagicMock()
            mock_delegation_factory._create_agent_with_error_handling = AsyncMock(
                return_value=(None, None)
            )

            MockFactory.return_value = mock_delegation_factory

            queue = asyncio.Queue()
            result = await executor.execute_step_only(mock_playbook_request, queue)

            assert result["success"] is False
            assert result["agent"] is None
            assert "Failed to create agent" in result["error"]

    @pytest.mark.asyncio
    async def test_execute_step_only_execution_failure(self, executor, mock_playbook_request):
        """Test step execution when agent execution fails."""
        with patch('src.smart_rag.playbook_dir.execute_step.AgentDelegationFactory') as MockFactory, \
             patch('src.smart_rag.playbook_dir.execute_step.langfuse_client'):

            mock_delegation_factory = MagicMock()
            mock_agent = MagicMock()
            mock_toolkit = MagicMock()

            mock_delegation_factory._create_agent_with_error_handling = AsyncMock(
                return_value=(mock_agent, mock_toolkit)
            )
            mock_delegation_factory._execute_agent_with_error_handling = AsyncMock(
                return_value=None
            )

            MockFactory.return_value = mock_delegation_factory

            queue = asyncio.Queue()
            result = await executor.execute_step_only(mock_playbook_request, queue)

            assert result["success"] is False
            assert result["agent"] == mock_agent
            assert "Agent execution returned no result" in result["error"]


class TestExecuteStep:
    """Test suite for execute_step method (main orchestration method)."""

    @pytest.mark.asyncio
    async def test_execute_step_success(self, executor, mock_playbook_request):
        """Test successful complete step execution with manager."""
        with patch.object(executor, '_retrieve_session_events') as mock_retrieve, \
             patch.object(executor, 'execute_step_only') as mock_execute_step, \
             patch.object(executor, '_modify_events_by_call_id') as mock_modify, \
             patch.object(executor, '_filter_events_up_to_call_id') as mock_filter, \
             patch.object(executor, '_reinject_events_to_database') as mock_reinject, \
             patch('src.smart_rag.playbook_dir.execute_step.PlaybookManagerExecutor') as MockManagerExecutor:

            # Setup mocks
            mock_event1 = MagicMock()
            mock_event1.model_copy = MagicMock(return_value=mock_event1)
            mock_event2 = MagicMock()
            mock_event2.model_copy = MagicMock(return_value=mock_event2)

            mock_retrieve.return_value = [mock_event1, mock_event2]
            mock_execute_step.return_value = {
                "success": True,
                "agent": MagicMock(),
                "result": "New step result"
            }
            mock_modify.return_value = 2
            mock_filter.return_value = [mock_event1, mock_event2]
            mock_reinject.return_value = None

            # Setup manager executor
            mock_manager_executor = MagicMock()
            mock_manager_executor.execute_manager = AsyncMock(return_value="Manager result")
            MockManagerExecutor.return_value = mock_manager_executor

            queue = asyncio.Queue()
            result = await executor.execute_step(mock_playbook_request, queue)

            assert result["success"] is True
            assert result["result"] == "Manager result"
            assert result["step_result"] == "New step result"
            assert "new_session_id" in result

    @pytest.mark.asyncio
    async def test_execute_step_retrieve_events_failure(self, executor, mock_playbook_request):
        """Test execute_step when retrieving events fails."""
        with patch.object(executor, '_retrieve_session_events') as mock_retrieve, \
             patch.object(executor, '_send_error_message') as mock_send_error:

            mock_retrieve.side_effect = ConnectionError("Database connection failed")
            mock_send_error.return_value = None

            queue = asyncio.Queue()
            result = await executor.execute_step(mock_playbook_request, queue)

            assert result["success"] is False
            assert "Failed to retrieve session events" in result["error"]

    @pytest.mark.asyncio
    async def test_execute_step_empty_events(self, executor, mock_playbook_request):
        """Test execute_step when no events are found."""
        with patch.object(executor, '_retrieve_session_events') as mock_retrieve, \
             patch.object(executor, '_send_error_message') as mock_send_error:

            mock_retrieve.return_value = []
            mock_send_error.return_value = None

            queue = asyncio.Queue()
            result = await executor.execute_step(mock_playbook_request, queue)

            assert result["success"] is False
            assert "No events found" in result["error"]

    @pytest.mark.asyncio
    async def test_execute_step_step_execution_failure(self, executor, mock_playbook_request):
        """Test execute_step when step execution fails."""
        with patch.object(executor, '_retrieve_session_events') as mock_retrieve, \
             patch.object(executor, 'execute_step_only') as mock_execute_step, \
             patch.object(executor, '_send_error_message') as mock_send_error:

            mock_event = MagicMock()
            mock_event.model_copy = MagicMock(return_value=mock_event)
            mock_retrieve.return_value = [mock_event]

            mock_execute_step.return_value = {
                "success": False,
                "error": "Agent creation failed"
            }
            mock_send_error.return_value = None

            queue = asyncio.Queue()
            result = await executor.execute_step(mock_playbook_request, queue)

            assert result["success"] is False
            assert "Agent creation failed" in result["error"]

    @pytest.mark.asyncio
    async def test_execute_step_reinject_failure(self, executor, mock_playbook_request):
        """Test execute_step when event reinjection fails."""
        with patch.object(executor, '_retrieve_session_events') as mock_retrieve, \
             patch.object(executor, 'execute_step_only') as mock_execute_step, \
             patch.object(executor, '_modify_events_by_call_id') as mock_modify, \
             patch.object(executor, '_filter_events_up_to_call_id') as mock_filter, \
             patch.object(executor, '_reinject_events_to_database') as mock_reinject, \
             patch.object(executor, '_send_error_message') as mock_send_error:

            mock_event = MagicMock()
            mock_event.model_copy = MagicMock(return_value=mock_event)
            mock_retrieve.return_value = [mock_event]

            mock_execute_step.return_value = {
                "success": True,
                "agent": MagicMock(),
                "result": "New result"
            }
            mock_modify.return_value = 1
            mock_filter.return_value = [mock_event]
            mock_reinject.side_effect = ConnectionError("Database write failed")
            mock_send_error.return_value = None

            queue = asyncio.Queue()
            result = await executor.execute_step(mock_playbook_request, queue)

            assert result["success"] is False
            assert "Error reinjecting events" in result["error"]

    @pytest.mark.asyncio
    async def test_execute_step_manager_failure_continues(self, executor, mock_playbook_request):
        """Test that execute_step continues even if manager execution fails."""
        with patch.object(executor, '_retrieve_session_events') as mock_retrieve, \
             patch.object(executor, 'execute_step_only') as mock_execute_step, \
             patch.object(executor, '_modify_events_by_call_id') as mock_modify, \
             patch.object(executor, '_filter_events_up_to_call_id') as mock_filter, \
             patch.object(executor, '_reinject_events_to_database') as mock_reinject, \
             patch('src.smart_rag.playbook_dir.execute_step.PlaybookManagerExecutor') as MockManagerExecutor:

            mock_event = MagicMock()
            mock_event.model_copy = MagicMock(return_value=mock_event)
            mock_retrieve.return_value = [mock_event]

            mock_execute_step.return_value = {
                "success": True,
                "agent": MagicMock(),
                "result": "New step result"
            }
            mock_modify.return_value = 1
            mock_filter.return_value = [mock_event]
            mock_reinject.return_value = None

            # Manager fails
            mock_manager_executor = MagicMock()
            mock_manager_executor.execute_manager = AsyncMock(
                side_effect=RuntimeError("Manager execution failed")
            )
            MockManagerExecutor.return_value = mock_manager_executor

            queue = asyncio.Queue()
            result = await executor.execute_step(mock_playbook_request, queue)

            # Should still succeed (step was successful)
            assert result["success"] is True
            assert result["step_result"] == "New step result"
            assert "Manager execution failed" in result["result"]


class TestExecutePlaybookStepFunction:
    """Test suite for execute_playbook_step function."""

    @pytest.mark.asyncio
    async def test_execute_playbook_step_creates_executor(self, mock_playbook_request):
        """Test that execute_playbook_step creates an executor and calls execute_step."""
        with patch('src.smart_rag.playbook_dir.execute_step.PlaybookStepExecutor') as MockExecutor:
            mock_executor = MagicMock()
            mock_executor.execute_step = AsyncMock(return_value={"success": True})
            MockExecutor.return_value = mock_executor

            queue = asyncio.Queue()
            result = await execute_playbook_step(mock_playbook_request, queue)

            # Verify executor was created
            MockExecutor.assert_called_once()
            # Verify execute_step was called
            mock_executor.execute_step.assert_called_once_with(mock_playbook_request, queue)
            # Verify result
            assert result["success"] is True
