"""Unit tests for playbook manager executor."""

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy.exc import SQLAlchemyError

from src.schema.playbook import RunPlaybookStepRequest
from src.schema.chatbot_schema import AgentSuggestion
from src.smart_rag.playbook_dir.execute_manager import PlaybookManagerExecutor


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
        workspace_names=["brain-1"],
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
        workspace_names=[],
        agent_type="manager",
        save_memory=False,
        agent_params={"temperature": 0.8}
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
def mock_config():
    """Create a mock config object."""
    config = MagicMock()
    config.session_id = "session-123"
    config.user_id = "user-123"
    config.chatbot_name = "gpt-4"
    config.workspace_names = ["brain-1"]
    config.vectorstore_name = "test-vectorstore"
    return config


@pytest.fixture
def mock_dependencies():
    """Create mock dependencies for PlaybookManagerExecutor."""
    return {
        'agent_factory': MagicMock(),
        'agent_runner': MagicMock(),
        'streaming_formatter': MagicMock(),
        'prompt_processor': MagicMock(),
        'llm_factory': MagicMock()
    }


@pytest.fixture
def manager_executor(mock_config, mock_dependencies):
    """Create a PlaybookManagerExecutor instance for testing."""
    return PlaybookManagerExecutor(
        agent_factory=mock_dependencies['agent_factory'],
        agent_runner=mock_dependencies['agent_runner'],
        streaming_formatter=mock_dependencies['streaming_formatter'],
        prompt_processor=mock_dependencies['prompt_processor'],
        llm_factory=mock_dependencies['llm_factory'],
        config=mock_config
    )


class TestPlaybookManagerExecutorInit:
    """Test suite for PlaybookManagerExecutor initialization."""

    def test_initialization(self, manager_executor):
        """Test that PlaybookManagerExecutor initializes correctly."""
        assert manager_executor is not None
        assert hasattr(manager_executor, 'agent_factory')
        assert hasattr(manager_executor, 'agent_runner')
        assert hasattr(manager_executor, 'streaming_formatter')
        assert hasattr(manager_executor, 'prompt_processor')
        assert hasattr(manager_executor, 'llm_factory')
        assert hasattr(manager_executor, 'config')
        assert hasattr(manager_executor, 'agent_helper')
        assert hasattr(manager_executor, 'document_helper')
        assert hasattr(manager_executor, 'agent_repository')
        assert hasattr(manager_executor, 'context_builder')
        assert hasattr(manager_executor, 'tool_description_provider')
        assert hasattr(manager_executor, 'delegation_factory')
        assert hasattr(manager_executor, 'agent_tools_manager')
        assert hasattr(manager_executor, 'manager_factory')
        assert hasattr(manager_executor, 'streaming_processor')
        assert hasattr(manager_executor, 'memory_service')


class TestExtractToolData:
    """Test suite for _extract_tool_data method."""

    def test_extract_tool_data_callable(self, manager_executor):
        """Test extracting data from a callable tool."""
        def test_tool():
            """Test tool docstring."""
            pass

        result = manager_executor._extract_tool_data(test_tool)

        assert result['name'] == 'test_tool'
        assert result['description'] == 'Test tool docstring.'
        assert result['prompt'] == ''

    def test_extract_tool_data_with_attributes(self, manager_executor):
        """Test extracting data from a tool with attributes."""
        # Create a real object with the attributes
        class MockTool:
            name = "search"
            description = "Search tool description"
            prompt = "Search prompt"

        tool = MockTool()
        result = manager_executor._extract_tool_data(tool)

        assert result['name'] == 'search'
        assert result['description'] == 'Search tool description'
        assert result['prompt'] == 'Search prompt'

    def test_extract_tool_data_object_without_attributes(self, manager_executor):
        """Test extracting data from an object without required attributes."""
        class TestTool:
            pass

        tool = TestTool()
        result = manager_executor._extract_tool_data(tool)

        assert result['name'] == 'TestTool'
        assert 'TestTool' in result['description']
        assert result['prompt'] == ''


class TestExecuteManager:
    """Test suite for execute_manager method."""

    @pytest.mark.asyncio
    async def test_execute_manager_success(self, manager_executor, mock_playbook_request):
        """Test successful manager execution."""
        with patch('src.smart_rag.playbook_dir.execute_manager.DatabaseSessionService') as MockSessionService, \
             patch('src.smart_rag.playbook_dir.execute_manager.Runner') as MockRunner:

            # Setup mocks
            mock_session_service = MagicMock()
            mock_session = MagicMock()
            mock_runner = MagicMock()

            MockSessionService.return_value = mock_session_service
            mock_session_service.get_session = AsyncMock(return_value=mock_session)
            MockRunner.return_value = mock_runner

            # Mock agent repository
            manager_executor.agent_repository.has_search_agents = MagicMock(return_value=False)
            manager_executor.agent_repository.set_agents = MagicMock()

            # Mock manager factory
            mock_manager_agent = MagicMock()
            mock_manager_agent.name = "Manager"
            manager_executor.manager_factory.create_manager_agent = MagicMock(
                return_value=mock_manager_agent
            )

            # Mock agent tools manager
            manager_executor.agent_tools_manager.create_tools_from_all_agents = MagicMock(
                return_value=[]
            )

            # Mock streaming processor
            manager_executor.streaming_processor.process_streaming_events = AsyncMock(
                return_value="Manager execution result"
            )

            # Mock streaming formatter
            manager_executor.streaming_formatter.format_streaming_event = MagicMock(
                return_value={"type": "start", "content": "Starting..."}
            )

            queue = asyncio.Queue()
            all_agents = [{"name": "Agent1", "tools": ["search"]}]

            result = await manager_executor.execute_manager(
                request=mock_playbook_request,
                session_id="session-123",
                queue=queue,
                all_agents=all_agents
            )

            assert result == "Manager execution result"
            manager_executor.agent_repository.set_agents.assert_called_once_with(all_agents)

    @pytest.mark.asyncio
    async def test_execute_manager_with_memory(self, manager_executor, mock_playbook_request):
        """Test manager execution with memory enabled."""
        # Enable memory for manager
        mock_playbook_request.manager_agent.save_memory = True

        with patch('src.smart_rag.playbook_dir.execute_manager.DatabaseSessionService') as MockSessionService, \
             patch('src.smart_rag.playbook_dir.execute_manager.Runner') as MockRunner:

            # Setup mocks
            mock_session_service = MagicMock()
            mock_session = MagicMock()

            MockSessionService.return_value = mock_session_service
            mock_session_service.get_session = AsyncMock(return_value=mock_session)
            MockRunner.return_value = MagicMock()

            # Mock memory service
            manager_executor.memory_service.initialize = AsyncMock()
            manager_executor.memory_service.create_manager_context = AsyncMock(
                return_value="\n\nMemory context: Previous conversations..."
            )
            manager_executor.memory_service.save_manager_conversation = AsyncMock()

            # Mock other components
            manager_executor.agent_repository.has_search_agents = MagicMock(return_value=False)
            mock_manager_agent = MagicMock()
            mock_manager_agent.name = "Manager"
            manager_executor.manager_factory.create_manager_agent = MagicMock(
                return_value=mock_manager_agent
            )
            manager_executor.agent_tools_manager.create_tools_from_all_agents = MagicMock(
                return_value=[]
            )
            manager_executor.streaming_processor.process_streaming_events = AsyncMock(
                return_value="Manager result with memory"
            )
            manager_executor.streaming_formatter.format_streaming_event = MagicMock(
                return_value={"type": "start"}
            )

            queue = asyncio.Queue()
            all_agents = []

            result = await manager_executor.execute_manager(
                request=mock_playbook_request,
                session_id="session-123",
                queue=queue,
                all_agents=all_agents
            )

            assert result == "Manager result with memory"
            # Verify memory was initialized and used
            manager_executor.memory_service.initialize.assert_called_once()
            manager_executor.memory_service.create_manager_context.assert_called_once()
            manager_executor.memory_service.save_manager_conversation.assert_called_once()

    @pytest.mark.asyncio
    async def test_execute_manager_session_not_found(self, manager_executor, mock_playbook_request):
        """Test manager execution when session doesn't exist (creates new session)."""
        with patch('src.smart_rag.playbook_dir.execute_manager.DatabaseSessionService') as MockSessionService, \
             patch('src.smart_rag.playbook_dir.execute_manager.Runner') as MockRunner:

            # Setup mocks
            mock_session_service = MagicMock()
            mock_new_session = MagicMock()

            MockSessionService.return_value = mock_session_service
            # Session doesn't exist
            mock_session_service.get_session = AsyncMock(return_value=None)
            # But creation succeeds
            mock_session_service.create_session = AsyncMock(return_value=mock_new_session)
            MockRunner.return_value = MagicMock()

            # Mock other components
            manager_executor.agent_repository.has_search_agents = MagicMock(return_value=False)
            mock_manager_agent = MagicMock()
            mock_manager_agent.name = "Manager"
            mock_manager_agent.instruction = "Manager instruction"
            manager_executor.manager_factory.create_manager_agent = MagicMock(
                return_value=mock_manager_agent
            )
            manager_executor.agent_tools_manager.create_tools_from_all_agents = MagicMock(
                return_value=[]
            )
            manager_executor.streaming_processor.process_streaming_events = AsyncMock(
                return_value="Result"
            )
            manager_executor.streaming_formatter.format_streaming_event = MagicMock(
                return_value={"type": "start"}
            )

            queue = asyncio.Queue()
            result = await manager_executor.execute_manager(
                request=mock_playbook_request,
                session_id="session-123",
                queue=queue,
                all_agents=[]
            )

            assert result == "Result"
            # Verify new session was created
            mock_session_service.create_session.assert_called_once()

    @pytest.mark.asyncio
    async def test_execute_manager_tool_creation_failure(self, manager_executor, mock_playbook_request):
        """Test manager execution when tool creation fails."""
        with patch('src.smart_rag.playbook_dir.execute_manager.DatabaseSessionService'):

            manager_executor.agent_repository.has_search_agents = MagicMock(return_value=False)
            manager_executor.agent_tools_manager.create_tools_from_all_agents = MagicMock(
                side_effect=RuntimeError("Tool creation failed")
            )

            queue = asyncio.Queue()

            with pytest.raises(RuntimeError, match="Failed to create tools from agents"):
                await manager_executor.execute_manager(
                    request=mock_playbook_request,
                    session_id="session-123",
                    queue=queue,
                    all_agents=[]
                )

    @pytest.mark.asyncio
    async def test_execute_manager_agent_creation_failure(self, manager_executor, mock_playbook_request):
        """Test manager execution when manager agent creation fails."""
        with patch('src.smart_rag.playbook_dir.execute_manager.DatabaseSessionService'):

            manager_executor.agent_repository.has_search_agents = MagicMock(return_value=False)
            manager_executor.agent_tools_manager.create_tools_from_all_agents = MagicMock(
                return_value=[]
            )
            manager_executor.manager_factory.create_manager_agent = MagicMock(
                side_effect=ValueError("Agent creation failed")
            )

            queue = asyncio.Queue()

            with pytest.raises(RuntimeError, match="Failed to create manager agent"):
                await manager_executor.execute_manager(
                    request=mock_playbook_request,
                    session_id="session-123",
                    queue=queue,
                    all_agents=[]
                )

    @pytest.mark.asyncio
    async def test_execute_manager_database_connection_failure(self, manager_executor, mock_playbook_request):
        """Test manager execution when database connection fails."""
        with patch('src.smart_rag.playbook_dir.execute_manager.DatabaseSessionService') as MockSessionService:

            MockSessionService.side_effect = SQLAlchemyError("Connection failed")

            manager_executor.agent_repository.has_search_agents = MagicMock(return_value=False)
            manager_executor.agent_tools_manager.create_tools_from_all_agents = MagicMock(
                return_value=[]
            )
            mock_manager_agent = MagicMock()
            manager_executor.manager_factory.create_manager_agent = MagicMock(
                return_value=mock_manager_agent
            )

            queue = asyncio.Queue()

            # The code wraps ConnectionError in RuntimeError at line 435
            with pytest.raises(RuntimeError, match="Failed to create database session service"):
                await manager_executor.execute_manager(
                    request=mock_playbook_request,
                    session_id="session-123",
                    queue=queue,
                    all_agents=[]
                )

    @pytest.mark.asyncio
    async def test_execute_manager_timeout(self, manager_executor, mock_playbook_request):
        """Test manager execution timeout."""
        with patch('src.smart_rag.playbook_dir.execute_manager.DatabaseSessionService') as MockSessionService, \
             patch('src.smart_rag.playbook_dir.execute_manager.Runner') as MockRunner:

            # Setup mocks
            mock_session_service = MagicMock()
            mock_session = MagicMock()

            MockSessionService.return_value = mock_session_service
            mock_session_service.get_session = AsyncMock(return_value=mock_session)
            MockRunner.return_value = MagicMock()

            manager_executor.agent_repository.has_search_agents = MagicMock(return_value=False)
            mock_manager_agent = MagicMock()
            mock_manager_agent.name = "Manager"
            manager_executor.manager_factory.create_manager_agent = MagicMock(
                return_value=mock_manager_agent
            )
            manager_executor.agent_tools_manager.create_tools_from_all_agents = MagicMock(
                return_value=[]
            )

            # Make processing timeout
            manager_executor.streaming_processor.process_streaming_events = AsyncMock(
                side_effect=asyncio.TimeoutError()
            )
            manager_executor.streaming_formatter.format_streaming_event = MagicMock(
                return_value={"type": "start"}
            )

            queue = asyncio.Queue()

            # The code wraps TimeoutError in RuntimeError at line 435
            with pytest.raises(RuntimeError, match="Manager execution timeout"):
                await manager_executor.execute_manager(
                    request=mock_playbook_request,
                    session_id="session-123",
                    queue=queue,
                    all_agents=[]
                )

    @pytest.mark.asyncio
    async def test_execute_manager_error_sent_to_queue(self, manager_executor, mock_playbook_request):
        """Test that errors are sent to the queue."""
        with patch('src.smart_rag.playbook_dir.execute_manager.DatabaseSessionService'):

            manager_executor.agent_repository.has_search_agents = MagicMock(return_value=False)
            manager_executor.agent_tools_manager.create_tools_from_all_agents = MagicMock(
                side_effect=RuntimeError("Tool creation failed")
            )
            manager_executor.streaming_formatter.format_streaming_event = MagicMock(
                return_value={"type": "error", "message": "Error"}
            )

            queue = asyncio.Queue()

            with pytest.raises(RuntimeError):
                await manager_executor.execute_manager(
                    request=mock_playbook_request,
                    session_id="session-123",
                    queue=queue,
                    all_agents=[]
                )

            # Verify error was sent to queue
            assert not queue.empty()
            error_message = await queue.get()
            assert error_message["type"] == "error"

    @pytest.mark.asyncio
    async def test_execute_manager_with_document_info(self, manager_executor, mock_playbook_request):
        """Test manager execution with document info."""
        with patch('src.smart_rag.playbook_dir.execute_manager.DatabaseSessionService') as MockSessionService, \
             patch('src.smart_rag.playbook_dir.execute_manager.Runner') as MockRunner:

            # Setup mocks
            mock_session_service = MagicMock()
            mock_session = MagicMock()

            MockSessionService.return_value = mock_session_service
            mock_session_service.get_session = AsyncMock(return_value=mock_session)
            MockRunner.return_value = MagicMock()

            # Mock document helper to return document info
            manager_executor.agent_repository.has_search_agents = MagicMock(return_value=True)
            manager_executor.document_helper._get_consolidated_document_tree_info_for_manager = MagicMock(
                return_value="Document tree info"
            )

            mock_manager_agent = MagicMock()
            mock_manager_agent.name = "Manager"
            manager_executor.manager_factory.create_manager_agent = MagicMock(
                return_value=mock_manager_agent
            )
            manager_executor.agent_tools_manager.create_tools_from_all_agents = MagicMock(
                return_value=[]
            )
            manager_executor.streaming_processor.process_streaming_events = AsyncMock(
                return_value="Result"
            )
            manager_executor.streaming_formatter.format_streaming_event = MagicMock(
                return_value={"type": "start"}
            )

            queue = asyncio.Queue()
            result = await manager_executor.execute_manager(
                request=mock_playbook_request,
                session_id="session-123",
                queue=queue,
                all_agents=[]
            )

            assert result == "Result"
            manager_executor.document_helper._get_consolidated_document_tree_info_for_manager.assert_not_called()
