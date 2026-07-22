"""Tests for SingleAgentService."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch, Mock
from google.genai import types

from src.smart_rag.core.single_agent_service import SingleAgentService
from src.schema.chatbot_schema import RunSingleAgentRequest, AgentSuggestion
from src.smart_rag.infrastructure.model_parameters import normalize_messages_for_model


@pytest.fixture
def mock_single_agent_request():
    """Mock single agent request for testing."""
    agent = AgentSuggestion(
        id="test_agent_01",
        name="TestAgent",
        description="Test agent for unit testing",
        prompt="You are a test assistant.",
        tools=[{"name": "search_documents", "description": "Search tool"}],
        chatbot_name={"name": "gpt-4.1", "provider": "azure/gpt-4.1"},
        vectorstore_name="vectorstorerec",
        workspace_names=["brain_123"],
        brain_documents=[
            {
                "_id": "doc_123",
                "filename": "test.pdf",
                "filepath": "brain_123/doc_123.pdf"
            }
        ]
    )

    request = RunSingleAgentRequest(
        user_id="test_user",
        session_id="test_session_123",
        message="Test message",
        agent=agent
    )
    return request


@pytest.fixture
def mock_queue():
    """Mock asyncio queue for testing."""
    queue = AsyncMock()
    queue.put = AsyncMock()
    return queue


@pytest.fixture
def mock_single_agent_request_no_tools():
    """Mock single agent request without tools."""
    agent = AgentSuggestion(
        id="simple_agent",
        name="SimpleAgent",
        description="Simple test agent",
        prompt="You are a simple assistant.",
        tools=[],
        chatbot_name={"name": "gpt-4.1", "provider": "azure/gpt-4.1"}
    )

    request = RunSingleAgentRequest(
        user_id="test_user",
        session_id="test_session_456",
        message="Hello",
        agent=agent
    )
    return request


@pytest.fixture
def mock_session_helper():
    """Mock SessionHelper for testing."""
    helper = AsyncMock()
    helper.init_session = AsyncMock(return_value="session_123")
    helper.cleanup = AsyncMock()

    # Mock runner
    mock_runner = AsyncMock()
    helper.runner = mock_runner

    # Create mock events for the run_async generator
    mock_event = MagicMock()
    mock_event.content = MagicMock()
    mock_event.content.parts = [MagicMock()]
    mock_event.content.parts[0].text = "Test response"
    mock_event.content.parts[0].function_call = None
    mock_event.content.parts[0].function_response = None
    mock_event.is_final_response = MagicMock(return_value=True)

    async def mock_run_async(*args, **kwargs):
        yield mock_event

    mock_runner.run_async = mock_run_async

    return helper


@pytest.fixture
def mock_adk_agent():
    """Mock ADK Agent for testing."""
    agent = MagicMock()
    agent.name = "TestAgent"
    agent.model = MagicMock()
    agent.instruction = "Test instruction"
    agent.tools = []
    return agent


class TestSingleAgentService:
    """Test cases for SingleAgentService."""

    def test_init(self):
        """Test service initialization."""
        service = SingleAgentService()
        assert service is not None
        assert service.prompt_processor is not None
        assert service.llm_factory is not None
        assert service.agent_factory is not None
        assert service.streaming_formatter is not None
        assert service.run_config is not None

    @pytest.mark.asyncio
    async def test_create_agent_with_search_tool(self, mock_single_agent_request, mock_llm_factory):
        """Test agent creation with search tool."""
        with patch('src.smart_rag.core.single_agent_service.SearchToolkit') as mock_toolkit_class, \
             patch('src.smart_rag.core.single_agent_service.SearchToolADK') as mock_search_tool_adk, \
             patch('src.smart_rag.core.single_agent_service.Agent') as mock_agent_class:

            # Setup mocks
            mock_toolkit = MagicMock()
            mock_toolkit.generate_function.return_value = (MagicMock(), {"name": "perform_standard_search"})
            mock_toolkit_class.return_value = mock_toolkit

            mock_search_tool = MagicMock()
            mock_search_tool.schema = {"name": "perform_standard_search"}
            mock_search_tool_adk.return_value = mock_search_tool

            mock_agent = MagicMock()
            mock_agent.name = "TestAgent"
            mock_agent_class.return_value = mock_agent

            service = SingleAgentService()
            service.llm_factory = mock_llm_factory

            # Test agent creation
            agent = await service._create_agent_from_request(mock_single_agent_request)

            assert agent is not None
            mock_toolkit_class.assert_called_once()
            mock_agent_class.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_agent_without_tools(self, mock_single_agent_request_no_tools, mock_llm_factory):
        """Test agent creation without tools."""
        with patch('src.smart_rag.core.single_agent_service.Agent') as mock_agent_class:
            mock_agent = MagicMock()
            mock_agent.name = "SimpleAgent"
            mock_agent_class.return_value = mock_agent

            service = SingleAgentService()
            service.llm_factory = mock_llm_factory

            # Test agent creation
            agent = await service._create_agent_from_request(mock_single_agent_request_no_tools)

            assert agent is not None
            mock_llm_factory.create_no_tool_calls_llm.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_agent_extracts_chatbot_name_from_dict(self, mock_single_agent_request, mock_llm_factory):
        """Test that chatbot_name is correctly extracted from dict format."""
        with patch('src.smart_rag.core.single_agent_service.Agent') as mock_agent_class, \
             patch('src.smart_rag.core.single_agent_service.SearchToolkit') as mock_toolkit_class, \
             patch('src.smart_rag.core.single_agent_service.SearchToolADK'):

            # Setup toolkit mock to return proper tuple
            mock_toolkit = MagicMock()
            mock_toolkit.generate_function.return_value = (MagicMock(), {"name": "perform_standard_search"})
            mock_toolkit_class.return_value = mock_toolkit

            mock_agent = MagicMock()
            mock_agent_class.return_value = mock_agent

            service = SingleAgentService()
            service.llm_factory = mock_llm_factory

            agent = await service._create_agent_from_request(mock_single_agent_request)

            # Verify that create_parallel_tool_calls_llm was called with extracted name
            mock_llm_factory.create_parallel_tool_calls_llm.assert_called_with("gpt-4.1", temperature=0.0)

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("modalities", "expected_types"),
        [(["text"], ["text"]), (["text", "image"], ["text", "image_url"])]
    )
    async def test_create_agent_registers_input_modalities(
        self, mock_single_agent_request, mock_llm_factory, modalities, expected_types
    ):
        mock_single_agent_request.agent.chatbot_name["input_modalities"] = modalities
        with patch('src.smart_rag.core.single_agent_service.Agent'), \
             patch('src.smart_rag.core.single_agent_service.SearchToolkit') as mock_toolkit_class, \
             patch('src.smart_rag.core.single_agent_service.SearchToolADK'):
            mock_toolkit_class.return_value.generate_function.return_value = (
                MagicMock(), {"name": "perform_standard_search"}
            )
            service = SingleAgentService()
            service.llm_factory = mock_llm_factory

            await service._create_agent_from_request(mock_single_agent_request)

        messages = [{"role": "user", "content": [
            {"type": "text", "text": "question"},
            {"type": "image_url", "image_url": {"url": "redacted"}},
        ]}]
        normalized = normalize_messages_for_model("gpt-4.1", messages)
        assert [part["type"] for part in normalized[0]["content"]] == expected_types

    @pytest.mark.asyncio
    async def test_create_agent_handles_exception(self, mock_single_agent_request):
        """Test agent creation handles exceptions gracefully."""
        with patch('src.smart_rag.core.single_agent_service.Agent') as mock_agent_class:
            mock_agent_class.side_effect = Exception("Agent creation failed")

            service = SingleAgentService()

            agent = await service._create_agent_from_request(mock_single_agent_request)

            assert agent is None

    @pytest.mark.asyncio
    async def test_execute_single_agent_success(self, mock_single_agent_request, mock_session_helper, mock_adk_agent, mock_queue):
        """Test successful single agent execution."""
        with patch('src.smart_rag.core.single_agent_service.SessionHelper') as mock_session_helper_class, \
             patch.object(SingleAgentService, '_create_agent_from_request', return_value=mock_adk_agent), \
             patch('src.smart_rag.core.single_agent_service.langfuse_client') as mock_langfuse:

            mock_session_helper_class.return_value = mock_session_helper
            mock_trace = MagicMock()
            mock_trace.id = "trace_123"
            mock_langfuse.trace.return_value = mock_trace
            mock_langfuse.span.return_value = MagicMock()

            service = SingleAgentService()

            await service.execute_single_agent(mock_single_agent_request, mock_queue)

            # Verify session was initialized
            mock_session_helper.init_session.assert_called_once()

            # Verify queue received messages
            assert mock_queue.put.called

    @pytest.mark.asyncio
    async def test_execute_single_agent_no_agent_created(self, mock_single_agent_request, mock_queue):
        """Test execution when agent creation fails."""
        with patch.object(SingleAgentService, '_create_agent_from_request', return_value=None), \
             patch('src.smart_rag.core.single_agent_service.langfuse_client'):

            service = SingleAgentService()

            await service.execute_single_agent(mock_single_agent_request, mock_queue)

            # Verify error message was sent
            assert mock_queue.put.called

    @pytest.mark.asyncio
    async def test_execute_single_agent_handles_exception(self, mock_single_agent_request, mock_queue):
        """Test execution handles exceptions and sends error message."""
        with patch('src.smart_rag.core.single_agent_service.SessionHelper') as mock_session_helper_class, \
             patch('src.smart_rag.core.single_agent_service.langfuse_client'):

            mock_session_helper_class.side_effect = Exception("Session creation failed")

            service = SingleAgentService()

            await service.execute_single_agent(mock_single_agent_request, mock_queue)

            # Verify error was handled and queue received error message
            assert mock_queue.put.called

    @pytest.mark.asyncio
    async def test_send_error_message(self, mock_queue):
        """Test error message formatting and sending."""
        service = SingleAgentService()

        await service._send_error_message(mock_queue, "test_session", "Test error message")

        # Verify queue received error message and completion signal
        assert mock_queue.put.call_count >= 2  # Error message + None completion signal

    @pytest.mark.asyncio
    async def test_cleanup_called_on_exception(self, mock_single_agent_request, mock_session_helper, mock_queue):
        """Test that session cleanup is called even when exception occurs."""
        with patch('src.smart_rag.core.single_agent_service.SessionHelper') as mock_session_helper_class, \
             patch.object(SingleAgentService, '_create_agent_from_request') as mock_create_agent, \
             patch('src.smart_rag.core.single_agent_service.langfuse_client'):

            mock_session_helper_class.return_value = mock_session_helper
            mock_create_agent.side_effect = Exception("Test exception")

            service = SingleAgentService()

            await service.execute_single_agent(mock_single_agent_request, mock_queue)

            # Verify cleanup was called despite exception
            mock_session_helper.cleanup.assert_called_once()

    def test_service_has_no_shared_state(self):
        """Test that service instances are independent."""
        service1 = SingleAgentService()
        service2 = SingleAgentService()

        assert service1 is not service2
        assert service1.llm_factory is not service2.llm_factory

    @pytest.mark.asyncio
    async def test_agent_with_calculator_tool(self, mock_single_agent_request_no_tools, mock_llm_factory):
        """Test agent creation with calculator tool."""
        # Modify request to include calculator tool
        mock_single_agent_request_no_tools.agent.tools = [{"name": "calculator"}]

        with patch('src.smart_rag.core.single_agent_service.Agent') as mock_agent_class, \
             patch('src.smart_rag.core.single_agent_service.calculator') as mock_calculator:

            mock_agent = MagicMock()
            mock_agent_class.return_value = mock_agent
            mock_calculator.schema = {"name": "calculator"}

            service = SingleAgentService()
            service.llm_factory = mock_llm_factory

            agent = await service._create_agent_from_request(mock_single_agent_request_no_tools)

            assert agent is not None
            # Verify parallel tool calls LLM was created (since we have tools)
            mock_llm_factory.create_parallel_tool_calls_llm.assert_called_once()

    @pytest.mark.asyncio
    async def test_search_web_parameter_used(self, mock_single_agent_request, mock_llm_factory):
        """Test that search_web parameter from agent tools is used."""
        # Add search_web tool to agent - need both search_documents and search_web
        mock_single_agent_request.agent.tools = [{"name": "search_documents"}, {"name": "search_web", "top_k": 3}]

        with patch('src.smart_rag.core.single_agent_service.SearchToolkit') as mock_toolkit_class, \
             patch('src.smart_rag.core.single_agent_service.SearchToolADK'), \
             patch('src.smart_rag.core.single_agent_service.Agent'):

            mock_toolkit = MagicMock()
            mock_toolkit.generate_function.return_value = (MagicMock(), {"name": "perform_web_search"})
            mock_toolkit_class.return_value = mock_toolkit

            service = SingleAgentService()
            service.llm_factory = mock_llm_factory

            await service._create_agent_from_request(mock_single_agent_request)

            # Verify SearchToolkit was called with search_web="standard"
            call_args = mock_toolkit_class.call_args
            assert call_args.kwargs['search_web'] == "standard"

    @pytest.mark.asyncio
    async def test_top_k_parameter_used(self, mock_single_agent_request, mock_llm_factory):
        """Test that top_k parameter from agent tools is used."""
        # Add tool with top_k parameter
        mock_single_agent_request.agent.tools = [{"name": "search_documents", "top_k": 5}]

        with patch('src.smart_rag.core.single_agent_service.SearchToolkit') as mock_toolkit_class, \
             patch('src.smart_rag.core.single_agent_service.SearchToolADK'), \
             patch('src.smart_rag.core.single_agent_service.Agent'):

            mock_toolkit = MagicMock()
            mock_toolkit.generate_function.return_value = (MagicMock(), {"name": "perform_document_search"})
            mock_toolkit_class.return_value = mock_toolkit

            service = SingleAgentService()
            service.llm_factory = mock_llm_factory

            await service._create_agent_from_request(mock_single_agent_request)

            # Verify SearchToolkit was called with top_k=5
            call_args = mock_toolkit_class.call_args
            assert call_args.kwargs['top_k'] == 5
