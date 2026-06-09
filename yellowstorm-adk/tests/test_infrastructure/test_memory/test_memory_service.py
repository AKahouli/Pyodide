"""Unit tests for MemoryService"""
import asyncio
import pytest
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from src.smart_rag.infrastructure.memory.memory_service import MemoryService


@pytest.fixture(autouse=True)
def reset_singleton():
    """Reset per-loop singleton state before each test."""
    MemoryService._loop_memories = {}
    MemoryService._locks = {}
    MemoryService._memory_cache = {}
    yield
    # Cleanup after test
    MemoryService._loop_memories = {}
    MemoryService._locks = {}
    MemoryService._memory_cache = {}


def set_memory_for_current_loop(mock_memory):
    """Helper to set mock memory for the current event loop."""
    try:
        loop = asyncio.get_running_loop()
        MemoryService._loop_memories[loop] = mock_memory
    except RuntimeError:
        # No running loop, this shouldn't happen in async tests
        pass


@pytest.fixture
def memory_service(mock_settings):
    """Create a MemoryService instance for testing."""
    service = MemoryService(settings=mock_settings)
    return service


@pytest.fixture
def mock_settings():
    """Mock settings configuration."""
    mock = Mock()
    mock.QDRANT_URL = "https://test-qdrant-url.com"
    mock.QDRANT_COLLECTION_NAME = "test-qdrant-collection"
    mock.QDRANT_API_KEY = "test-qdrant-api-key"
    mock.EMBEDDING_DIMS = 3072
    mock.LITELLM_API_SECRET_KEY = "test-litellm-key"
    mock.LITELLM_API_BASE_URL = "https://test-litellm-url.com"
    mock.MEMORY_MODEL = "gpt-4o-mini"
    return mock


@pytest.fixture
def mock_async_memory():
    """Create a mock AsyncMemory instance."""
    mock = AsyncMock()
    return mock


@pytest.fixture
def sample_messages():
    """Sample messages for testing."""
    return [
        {"role": "user", "content": "Hello, I need help with my project"},
        {"role": "assistant", "content": "I'd be happy to help you with your project. What do you need assistance with?"}
    ]


@pytest.fixture
def sample_search_results():
    """Sample search results from mem0."""
    return {
        "results": [
            {"memory": "User previously worked on a Python project", "score": 0.95},
            {"memory": "User prefers detailed explanations", "score": 0.88},
            {"memory": "User is working with FastAPI", "score": 0.82}
        ]
    }


class TestMemoryService:
    """Test cases for MemoryService."""

    @pytest.mark.unit
    def test_init(self, memory_service):
        """Test MemoryService initialization."""
        assert memory_service.memory is None
        assert memory_service._config is not None
        assert "vector_store" in memory_service._config
        assert "llm" in memory_service._config
        assert "embedder" in memory_service._config

    @pytest.mark.unit
    def test_config_structure(self, memory_service, mock_settings):
        """Test that config has the correct structure."""
        config = memory_service._config

        # Test vector store config - now uses qdrant
        assert config["vector_store"]["provider"] == "qdrant"
        assert "url" in config["vector_store"]["config"]
        assert "collection_name" in config["vector_store"]["config"]
        assert "api_key" in config["vector_store"]["config"]
        assert config["vector_store"]["config"]["embedding_model_dims"] == mock_settings.EMBEDDING_DIMS

        # Test LLM config
        assert config["llm"]["provider"] == "litellm"
        assert config["llm"]["config"]["model"] == mock_settings.MEMORY_MODEL
        assert config["llm"]["config"]["temperature"] == 0.0
        assert config["llm"]["config"]["max_tokens"] == 4000

        # Test embedder config
        assert config["embedder"]["provider"] == "openai"
        assert config["embedder"]["config"]["model"] == "azure/text-embedding-3-large"
        assert config["embedder"]["config"]["embedding_dims"] == 3072

    @pytest.mark.unit
    @pytest.mark.asyncio
    @patch('mem0.AsyncMemory')
    async def test_initialize_success(self, mock_async_memory_class, memory_service):
        """Test successful initialization."""
        mock_memory_instance = AsyncMock()
        mock_async_memory_class.from_config = AsyncMock(return_value=mock_memory_instance)

        await memory_service.initialize()

        # Get current event loop and verify memory is stored for it
        loop = asyncio.get_running_loop()
        assert loop in MemoryService._loop_memories
        assert MemoryService._loop_memories[loop] == mock_memory_instance
        assert memory_service.memory == mock_memory_instance
        mock_async_memory_class.from_config.assert_called_once_with(memory_service._config)

    @pytest.mark.unit
    @pytest.mark.asyncio
    @patch('mem0.AsyncMemory')
    async def test_initialize_failure(self, mock_async_memory_class, memory_service):
        """Test initialization failure."""
        mock_async_memory_class.from_config = AsyncMock(side_effect=Exception("Connection failed"))

        # Mock the logger instance
        with patch.object(memory_service, '_logger') as mock_logger:
            await memory_service.initialize()

            assert memory_service.memory is None
            mock_logger.exception.assert_called_once()

    @pytest.mark.unit
    @pytest.mark.asyncio
    @patch('mem0.AsyncMemory')
    async def test_initialize_with_empty_llm_model(self, mock_async_memory_class, memory_service):
        """Test initialization uses model from settings."""
        mock_memory_instance = AsyncMock()
        mock_async_memory_class.from_config = AsyncMock(return_value=mock_memory_instance)

        await memory_service.initialize()

        loop = asyncio.get_running_loop()
        assert loop in MemoryService._loop_memories
        assert MemoryService._loop_memories[loop] == mock_memory_instance
        assert memory_service.memory == mock_memory_instance
        # Verify the config uses the model from settings
        assert memory_service._config["llm"]["config"]["model"] == "gpt-4o-mini"
        mock_async_memory_class.from_config.assert_called_once_with(memory_service._config)

    @pytest.mark.unit
    @pytest.mark.asyncio
    @patch('mem0.AsyncMemory')
    async def test_initialize_with_custom_llm_model(self, mock_async_memory_class, memory_service):
        """Test initialization uses the model from settings."""
        mock_memory_instance = AsyncMock()
        mock_async_memory_class.from_config = AsyncMock(return_value=mock_memory_instance)

        await memory_service.initialize()

        loop = asyncio.get_running_loop()
        assert loop in MemoryService._loop_memories
        assert MemoryService._loop_memories[loop] == mock_memory_instance
        assert memory_service.memory == mock_memory_instance
        # The model comes from the settings (MEMORY_MODEL)
        assert memory_service._config["llm"]["config"]["model"] == "gpt-4o-mini"
        mock_async_memory_class.from_config.assert_called_once_with(memory_service._config)

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_get_relevant_memories_no_memory(self, memory_service):
        """Test get_relevant_memories when memory is not initialized."""
        result = await memory_service.get_relevant_memories("test message", "user123")

        assert result == ""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_get_relevant_memories_success(self, memory_service, mock_async_memory, sample_search_results):
        """Test successful retrieval of relevant memories."""
        set_memory_for_current_loop(mock_async_memory)
        mock_async_memory.search.return_value = sample_search_results

        result = await memory_service.get_relevant_memories("test message", "user123", limit=5)

        expected = "- User previously worked on a Python project\n- User prefers detailed explanations\n- User is working with FastAPI"
        assert result == expected
        mock_async_memory.search.assert_called_once_with(
            query="test message",
            user_id="user123",
            limit=5
        )

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_get_relevant_memories_empty_results(self, memory_service, mock_async_memory):
        """Test get_relevant_memories with empty results."""
        set_memory_for_current_loop(mock_async_memory)
        mock_async_memory.search.return_value = {"results": []}

        result = await memory_service.get_relevant_memories("test message", "user123")

        assert result == ""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_get_relevant_memories_no_results_key(self, memory_service, mock_async_memory):
        """Test get_relevant_memories with no results key."""
        set_memory_for_current_loop(mock_async_memory)
        mock_async_memory.search.return_value = {}

        result = await memory_service.get_relevant_memories("test message", "user123")

        assert result == ""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_get_relevant_memories_missing_memory_field(self, memory_service, mock_async_memory):
        """Test get_relevant_memories with missing memory field in results."""
        set_memory_for_current_loop(mock_async_memory)
        mock_async_memory.search.return_value = {
            "results": [
                {"score": 0.95},  # Missing memory field
                {"memory": "Valid memory", "score": 0.88}
            ]
        }

        result = await memory_service.get_relevant_memories("test message", "user123")

        assert result == "- Valid memory"

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_get_relevant_memories_exception(self, memory_service, mock_async_memory):
        """Test get_relevant_memories with exception."""
        set_memory_for_current_loop(mock_async_memory)
        mock_async_memory.search.side_effect = Exception("Search failed")

        with patch.object(memory_service, '_logger') as mock_logger:
            result = await memory_service.get_relevant_memories("test message", "user123")

            assert result == ""
            mock_logger.exception.assert_called_once()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_save_manager_conversation_no_memory(self, memory_service, sample_messages):
        """Test save_manager_conversation when memory is not initialized."""
        result = await memory_service.save_manager_conversation(sample_messages, "user123")

        assert result is False

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_save_manager_conversation_success(self, memory_service, mock_async_memory, sample_messages):
        """Test successful save of manager conversation."""
        set_memory_for_current_loop(mock_async_memory)
        mock_async_memory.add.return_value = None

        result = await memory_service.save_manager_conversation(sample_messages, "user123")

        assert result is True
        mock_async_memory.add.assert_called_once_with(sample_messages, user_id="user123")

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_save_manager_conversation_exception(self, memory_service, mock_async_memory, sample_messages):
        """Test save_manager_conversation with exception."""
        set_memory_for_current_loop(mock_async_memory)
        mock_async_memory.add.side_effect = Exception("Save failed")

        with patch.object(memory_service, '_logger') as mock_logger:
            result = await memory_service.save_manager_conversation(sample_messages, "user123")

            assert result is False
            mock_logger.exception.assert_called_once()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_create_manager_context_with_memories(self, memory_service, mock_async_memory, sample_search_results):
        """Test create_manager_context when memories are found."""
        set_memory_for_current_loop(mock_async_memory)
        mock_async_memory.search.return_value = sample_search_results

        result = await memory_service.create_manager_context("test message", "user123")

        expected_memories = "- User previously worked on a Python project\n- User prefers detailed explanations\n- User is working with FastAPI"
        expected = f"\n\n< manager_memories >\nRelevant memories from previous conversations:\n{expected_memories}\n< /manager_memories >"
        assert result == expected

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_create_manager_context_no_memories(self, memory_service, mock_async_memory):
        """Test create_manager_context when no memories are found."""
        set_memory_for_current_loop(mock_async_memory)
        mock_async_memory.search.return_value = {"results": []}

        result = await memory_service.create_manager_context("test message", "user123")

        assert result == ""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_create_manager_context_no_memory_service(self, memory_service):
        """Test create_manager_context when memory service is not initialized."""
        result = await memory_service.create_manager_context("test message", "user123")

        assert result == ""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_get_relevant_memories_default_limit(self, memory_service, mock_async_memory, sample_search_results):
        """Test get_relevant_memories with default limit."""
        set_memory_for_current_loop(mock_async_memory)
        mock_async_memory.search.return_value = sample_search_results

        await memory_service.get_relevant_memories("test message", "user123")

        mock_async_memory.search.assert_called_once_with(
            query="test message",
            user_id="user123",
            limit=10
        )

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_get_relevant_memories_custom_limit(self, memory_service, mock_async_memory, sample_search_results):
        """Test get_relevant_memories with custom limit."""
        set_memory_for_current_loop(mock_async_memory)
        mock_async_memory.search.return_value = sample_search_results

        await memory_service.get_relevant_memories("test message", "user123", limit=3)

        mock_async_memory.search.assert_called_once_with(
            query="test message",
            user_id="user123",
            limit=3
        )

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_clear_agent_memory_no_memory(self, memory_service):
        """Test clear_agent_memory when memory is not initialized."""
        result = await memory_service.clear_agent_memory("agent123")

        assert result is False

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_clear_agent_memory_success(self, memory_service, mock_async_memory):
        """Test successful clear of agent memory."""
        set_memory_for_current_loop(mock_async_memory)
        mock_async_memory.delete_all = AsyncMock()

        result = await memory_service.clear_agent_memory("agent123")

        assert result is True
        mock_async_memory.delete_all.assert_called_once_with(agent_id="agent123")

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_clear_agent_memory_empty_agent_id(self, memory_service, mock_async_memory):
        """Test clear_agent_memory with empty agent_id."""
        set_memory_for_current_loop(mock_async_memory)

        result = await memory_service.clear_agent_memory("")

        assert result is False
        mock_async_memory.delete_all.assert_not_called()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_clear_agent_memory_whitespace_agent_id(self, memory_service, mock_async_memory):
        """Test clear_agent_memory with whitespace agent_id."""
        set_memory_for_current_loop(mock_async_memory)

        result = await memory_service.clear_agent_memory("   ")

        assert result is False
        mock_async_memory.delete_all.assert_not_called()

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_clear_agent_memory_exception(self, memory_service, mock_async_memory):
        """Test clear_agent_memory with exception."""
        set_memory_for_current_loop(mock_async_memory)
        mock_async_memory.delete_all = AsyncMock(side_effect=Exception("Delete failed"))

        with patch.object(memory_service, '_logger') as mock_logger:
            result = await memory_service.clear_agent_memory("agent123")

            assert result is False
            mock_logger.exception.assert_called_once()
            assert "Failed to clear memories for agent agent123" in str(mock_logger.exception.call_args)