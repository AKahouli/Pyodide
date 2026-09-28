"""Tests for ManagerAgentFactory."""

from unittest.mock import MagicMock, patch

import pytest

from src.smart_rag.agents.factories.manager_factory import ManagerAgentFactory


class TestManagerAgentFactory:
    """Test cases for ManagerAgentFactory."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock config object."""
        config = MagicMock()
        config.chatbot_name = "test_chatbot"
        config.doc_tree = [{"id": "1", "nom": "test_doc.pdf"}]
        config.brain_tree = []
        return config

    @pytest.fixture
    def mock_prompt_processor(self):
        """Create a mock prompt processor."""
        processor = MagicMock()
        processor.extract_chatbot_name_and_clean_prompt.return_value = ("cleaned_prompt", "test_chatbot")
        processor.get_web_search_prompt.return_value = "\nWeb search enabled."
        return processor

    @pytest.fixture
    def mock_llm_factory(self):
        """Create a mock LLM factory."""
        factory = MagicMock()
        factory.create_parallel_tool_calls_llm.return_value = MagicMock()
        factory.create_no_parallel_tool_calls_llm.return_value = MagicMock()
        return factory

    @pytest.fixture
    def mock_agent_repository(self):
        """Create a mock agent repository."""
        repository = MagicMock()
        repository.has_search_agents.return_value = False
        repository.get_all_agents.return_value = []
        return repository

    @pytest.fixture
    def mock_tool_provider(self):
        """Create a mock tool provider."""
        return MagicMock()

    @pytest.fixture
    def mock_context_builder(self):
        """Create a mock context builder."""
        return MagicMock()

    @pytest.fixture
    def mock_agent_helper(self):
        """Create a mock agent helper."""
        helper = MagicMock()
        helper.get_document_tree_info.return_value = ""
        return helper

    @pytest.fixture
    def manager_factory(self, mock_config, mock_prompt_processor, mock_llm_factory,
                        mock_agent_repository, mock_tool_provider, mock_context_builder,
                        mock_agent_helper):
        """Create a ManagerAgentFactory instance with mocked dependencies."""
        return ManagerAgentFactory(
            config=mock_config,
            prompt_processor=mock_prompt_processor,
            llm_factory=mock_llm_factory,
            agent_repository=mock_agent_repository,
            tool_provider=mock_tool_provider,
            context_builder=mock_context_builder,
            agent_helper=mock_agent_helper
        )

    def test_initialization(self, manager_factory, mock_config):
        """Test that ManagerAgentFactory initializes correctly."""
        assert manager_factory.config == mock_config
        assert manager_factory.chatbot_name == "test_chatbot"
        assert manager_factory.document_helper is not None

    def test_initialization_with_missing_chatbot_name(self, mock_prompt_processor, mock_llm_factory,
                                                       mock_agent_repository, mock_tool_provider,
                                                       mock_context_builder, mock_agent_helper):
        """Test initialization when config has no chatbot_name attribute."""
        config = MagicMock(spec=[])  # Config without chatbot_name attribute
        factory = ManagerAgentFactory(
            config=config,
            prompt_processor=mock_prompt_processor,
            llm_factory=mock_llm_factory,
            agent_repository=mock_agent_repository,
            tool_provider=mock_tool_provider,
            context_builder=mock_context_builder,
            agent_helper=mock_agent_helper
        )
        assert factory.chatbot_name == 'default'

    @patch('src.smart_rag.agents.factories.base_factory.Agent')
    def test_create_manager_agent_basic(self, mock_agent_class, manager_factory, mock_llm_factory):
        """Test basic manager agent creation."""
        mock_delegation_factory = MagicMock()
        manager_prompt = "Test manager prompt"
        tools = [MagicMock(), MagicMock()]
        temperature = 0

        result = manager_factory.create_manager_agent(
            manager_prompt=manager_prompt,
            tools=tools,
            delegation_factory=mock_delegation_factory,
            manager_temperature=temperature
        )

        # Verify LLM was created with correct parameters
        mock_llm_factory.create_no_parallel_tool_calls_llm.assert_called_once_with(
            "test_chatbot",
            temperature=temperature,
            tool_choice="auto"
        )

        # Verify Agent was instantiated
        mock_agent_class.assert_called_once()
        call_kwargs = mock_agent_class.call_args[1]
        assert call_kwargs['name'] == 'manager_agent'
        assert call_kwargs['tools'] == tools
        assert result._team_instance == mock_delegation_factory

    @patch('src.smart_rag.agents.factories.base_factory.Agent')
    def test_create_manager_agent_with_callbacks(self, mock_agent_class, manager_factory):
        """Test that manager agent is created with proper callbacks."""
        mock_delegation_factory = MagicMock()
        manager_prompt = "Test manager prompt"
        tools = []
        temperature = 0.5

        manager_factory.create_manager_agent(
            manager_prompt=manager_prompt,
            tools=tools,
            delegation_factory=mock_delegation_factory,
            manager_temperature=temperature
        )

        call_kwargs = mock_agent_class.call_args[1]
        assert 'before_tool_callback' in call_kwargs
        assert 'before_agent_callback' in call_kwargs
        assert 'after_agent_callback' in call_kwargs
        assert isinstance(call_kwargs['before_agent_callback'], list)
        assert len(call_kwargs['before_agent_callback']) == 2

    def test_create_manager_instruction_without_search_agents(self, manager_factory,
                                                               mock_prompt_processor,
                                                               mock_agent_repository):
        """Test manager instruction creation when no search agents exist."""
        mock_agent_repository.has_search_agents.return_value = False
        mock_agent_repository.has_code_interpreter.return_value = False
        manager_prompt = "Base manager prompt"

        result = manager_factory._create_manager_instruction(manager_prompt)

        mock_prompt_processor.extract_chatbot_name_and_clean_prompt.assert_called_once_with(manager_prompt)
        mock_prompt_processor.get_web_search_prompt.assert_called_once_with(1)
        assert result == "cleaned_prompt\nWeb search enabled."

    def test_create_manager_instruction_with_search_agents(self, manager_factory,
                                                            mock_prompt_processor,
                                                            mock_agent_repository):
        """Test manager instruction creation when search agents exist."""
        mock_agent_repository.has_search_agents.return_value = True
        mock_agent_repository.get_all_agents.return_value = [MagicMock()]
        manager_prompt = "Base manager prompt"

        with patch.object(manager_factory.document_helper,
                          '_get_consolidated_document_tree_info_for_manager',
                          return_value="\nDocument tree info"):
            result = manager_factory._create_manager_instruction(manager_prompt)

        assert "Document tree info" in result
        assert "cleaned_prompt" in result

    def test_get_document_tree_info(self, manager_factory, mock_agent_helper):
        """Test getting document tree info."""
        doc_tree = [{"id": "1", "name": "doc1"}]
        brain_tree = {"nodes": [], "relationships": []}
        mock_agent_helper.get_document_tree_info.return_value = "formatted tree"

        result = manager_factory._get_document_tree_info(doc_tree, brain_tree)

        mock_agent_helper.get_document_tree_info.assert_called_once_with(doc_tree, brain_tree)
        assert result == "formatted tree"


class TestManagerAgentFactoryCallbacks:
    """Test the callback functions created within ManagerAgentFactory."""

    @pytest.fixture
    def manager_factory_with_mocks(self):
        """Create a manager factory with all mocked dependencies."""
        config = MagicMock()
        config.chatbot_name = "test_chatbot"
        config.doc_tree = [{"id": "1", "nom": "test_doc.pdf"}]
        config.brain_tree = []

        prompt_processor = MagicMock()
        prompt_processor.extract_chatbot_name_and_clean_prompt.return_value = ("cleaned_prompt", "test_chatbot")
        prompt_processor.get_web_search_prompt.return_value = "\nWeb search enabled."

        llm_factory = MagicMock()
        llm_factory.create_parallel_tool_calls_llm.return_value = MagicMock()
        llm_factory.create_no_parallel_tool_calls_llm.return_value = MagicMock()

        agent_repository = MagicMock()
        agent_repository.has_search_agents.return_value = True

        tool_provider = MagicMock()
        context_builder = MagicMock()
        agent_helper = MagicMock()

        return ManagerAgentFactory(
            config=config,
            prompt_processor=prompt_processor,
            llm_factory=llm_factory,
            agent_repository=agent_repository,
            tool_provider=tool_provider,
            context_builder=context_builder,
            agent_helper=agent_helper
        )

    @patch('src.smart_rag.agents.factories.base_factory.Agent')
    def test_check_if_agent_with_search_callback(self, mock_agent_class, manager_factory_with_mocks):
        """Test the check_if_agent_with_search_in_team callback."""
        mock_delegation_factory = MagicMock()
        mock_delegation_factory.task_search_order = 0

        # Create manager agent to get access to callbacks
        manager_factory_with_mocks.create_manager_agent(
            manager_prompt="test",
            tools=[],
            delegation_factory=mock_delegation_factory,
            manager_temperature=0.5
        )

        # Get the callback function
        call_kwargs = mock_agent_class.call_args[1]
        before_callbacks = call_kwargs['before_agent_callback']
        check_callback = before_callbacks[0]

        # Create mock callback context
        mock_context = MagicMock()
        mock_context.state = {}

        # Execute callback
        result = check_callback(mock_context)

        assert result is None
        assert "has_search_agents" in mock_context.state
        assert mock_context.state["has_search_agents"] is True

    @patch('src.smart_rag.agents.factories.base_factory.Agent')
    def test_add_task_order_to_state_callback(self, mock_agent_class, manager_factory_with_mocks):
        """Test the add_task_order_to_state callback."""
        mock_delegation_factory = MagicMock()
        mock_delegation_factory.task_search_order = 5

        # Create manager agent
        manager_factory_with_mocks.create_manager_agent(
            manager_prompt="test",
            tools=[],
            delegation_factory=mock_delegation_factory,
            manager_temperature=0.5
        )

        # Get the after_agent_callback
        call_kwargs = mock_agent_class.call_args[1]
        after_callback = call_kwargs['after_agent_callback']

        # Create mock callback context
        mock_context = MagicMock()
        mock_context.state = {}

        # Execute callback
        result = after_callback(mock_context)

        assert result is None
        assert mock_context.state["task_search_order"] == 5
        assert "has_search_agents" in mock_context.state


class TestManagerAgentFactoryIntegration:
    """Integration tests for ManagerAgentFactory."""

    @patch('src.smart_rag.agents.factories.base_factory.Agent')
    def test_full_manager_creation_flow(self, mock_agent_class):
        """Test complete flow of creating a manager agent."""
        # Setup all mocks
        config = MagicMock()
        config.chatbot_name = "gemini"
        config.doc_tree = [{"id": "1", "nom": "test_doc.pdf"}]
        config.brain_tree = []

        prompt_processor = MagicMock()
        prompt_processor.extract_chatbot_name_and_clean_prompt.return_value = ("clean prompt", "gemini")
        prompt_processor.get_web_search_prompt.return_value = "\nSearch enabled"

        llm_factory = MagicMock()
        mock_model = MagicMock()
        llm_factory.create_no_parallel_tool_calls_llm.return_value = mock_model

        agent_repository = MagicMock()
        agent_repository.has_search_agents.return_value = False

        tool_provider = MagicMock()
        context_builder = MagicMock()
        agent_helper = MagicMock()

        # Create factory
        factory = ManagerAgentFactory(
            config=config,
            prompt_processor=prompt_processor,
            llm_factory=llm_factory,
            agent_repository=agent_repository,
            tool_provider=tool_provider,
            context_builder=context_builder,
            agent_helper=agent_helper
        )

        # Create manager agent
        mock_delegation = MagicMock()
        tools = [MagicMock(name="tool1"), MagicMock(name="tool2")]
        temperature = 0.8

        result = factory.create_manager_agent(
            manager_prompt="Coordinate the team",
            tools=tools,
            delegation_factory=mock_delegation,
            manager_temperature=temperature
        )

        # Verify all components were called correctly
        llm_factory.create_no_parallel_tool_calls_llm.assert_called_once_with(
            "gemini",
            temperature=temperature,
            tool_choice="auto"
        )
        prompt_processor.extract_chatbot_name_and_clean_prompt.assert_called_once()
        mock_agent_class.assert_called_once()

        # Verify agent was created with correct parameters
        call_kwargs = mock_agent_class.call_args[1]
        assert call_kwargs['model'] == mock_model
        assert call_kwargs['tools'] == tools
        assert "clean prompt" in call_kwargs['instruction']