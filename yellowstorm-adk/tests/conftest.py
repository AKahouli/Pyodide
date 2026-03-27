"""Pytest configuration and fixtures for smart_rag tests."""

import asyncio
import os
import sys
from unittest.mock import MagicMock, Mock
from typing import Dict, List, Optional, Any
import pytest
from dotenv import load_dotenv

# Load test environment variables
load_dotenv('.env.test')

# Import and use values from common schema BEFORE any other imports
from tests.common_schema import MockSettings

# Set mock environment variables from common schema
mock_settings = MockSettings()
import json
mock_fields = getattr(MockSettings, "model_fields", None) or getattr(MockSettings, "__fields__", {})
for field_name, field_info in mock_fields.items():
    field_value = getattr(mock_settings, field_name)
    # Skip complex types (List, Dict) - they'll be handled by mocking get_settings directly
    if field_value is None:
        env_value = ""
    elif isinstance(field_value, (list, dict)):
        # Skip complex types - conftest mocking will handle them
        continue
    else:
        env_value = str(field_value)
    os.environ[field_name] = env_value

# Ensure test environment is set (no ENVIRONMENT or LANGFUSE_ENABLED in Settings)

# Create a mock Langfuse client with the necessary methods
class MockLangfuseClient:
    def span(self, *args, **kwargs):
        mock_span = MagicMock()
        mock_span.id = "mock_span_id"
        return mock_span

    def trace(self, *args, **kwargs):
        mock_trace = MagicMock()
        mock_trace.id = "mock_trace_id"
        return mock_trace

    def generation(self, *args, **kwargs):
        mock_generation = MagicMock()
        mock_generation.id = "mock_generation_id"
        return mock_generation

# Mock langfuse to prevent any network calls
try:
    import langfuse
    # Replace the Langfuse class with our mock
    langfuse.Langfuse = lambda *args, **kwargs: MockLangfuseClient()

    # Also patch the langfuse_client in the config module
    if 'src.smart_rag.engines.multi_agent.config' in sys.modules:
        sys.modules['src.smart_rag.engines.multi_agent.config'].langfuse_client = MockLangfuseClient()

except ImportError:
    pass

# Add src to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from src.smart_rag.infrastructure.factories.llm_factory import LLMFactory
from src.smart_rag.infrastructure.processing.prompt_processor import PromptProcessor



@pytest.fixture(autouse=True)
def mock_settings_global(monkeypatch):
    import src.config.settings as settings_module
    from tests.common_schema import MockSettings
    mock_settings_instance = MockSettings()
    monkeypatch.setattr(settings_module, "get_settings", lambda: mock_settings_instance)

    # Mock langfuse_client in config modules
    try:
        mock_client = MockLangfuseClient()

        # Patch langfuse_client in multi_agent config
        try:
            import src.smart_rag.engines.multi_agent.config as multi_agent_config
            monkeypatch.setattr(multi_agent_config, "langfuse_client", mock_client)
        except ImportError:
            pass

        # Patch any other modules that might import langfuse_client
        try:
            import src.smart_rag.engines.traditional.orchestrator as traditional_orchestrator
            if hasattr(traditional_orchestrator, 'langfuse_client'):
                monkeypatch.setattr(traditional_orchestrator, "langfuse_client", mock_client)
        except ImportError:
            pass

    except ImportError:
        pass



@pytest.fixture
def event_loop():
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def mock_llm_factory():
    """Mock LLM factory for testing."""
    factory = MagicMock(spec=LLMFactory)

    # Mock LLM instance
    mock_llm = MagicMock()
    mock_llm.model_name = "test-model"

    factory.create_parallel_tool_calls_llm.return_value = mock_llm
    factory.create_no_tool_calls_llm.return_value = mock_llm

    return factory


@pytest.fixture
def mock_prompt_processor():
    """Mock prompt processor for testing."""
    processor = MagicMock(spec=PromptProcessor)
    processor.extract_chatbot_name_and_clean_prompt.return_value = ("test prompt", "test-model")
    processor.get_web_search_prompt.return_value = "web search prompt"
    return processor

@pytest.fixture
def sample_messages():
    """Sample conversation messages."""
    return [
        {"role": "user", "content": "Hello, I need help with my project"},
        {"role": "assistant", "content": "I'd be happy to help you with your project. What do you need assistance with?"},
        {"role": "user", "content": "I'm working on a Python API using FastAPI"},
        {"role": "assistant", "content": "Great! FastAPI is an excellent choice for building APIs. What specific aspect would you like help with?"}
    ]

@pytest.fixture
def sample_doc_tree():
    """Sample document tree for testing."""
    return [
        {
            "name": "Document 1",
            "id": "doc1",
            "description": "Test document 1"
        },
        {
            "name": "Document 2",
            "id": "doc2",
            "description": "Test document 2"
        }
    ]


@pytest.fixture
def sample_brain_tree():
    """Sample brain tree for testing."""
    return [
        {
            "name": "Brain 1",
            "id": "brain1",
            "description": "Test brain 1"
        }
    ]

@pytest.fixture
def sample_user_id():
    """Sample user ID for testing."""
    return "test_user_123"


@pytest.fixture
def sample_brain_ids():
    """Sample brain IDs for testing."""
    return ["brain1", "brain2"]

@pytest.fixture
def sample_search_query():
    """Sample search query."""
    return "How to implement authentication in FastAPI?"



@pytest.fixture
def mock_agent():
    """Mock agent for testing."""
    agent = MagicMock()
    agent.name = "TestAgent"
    agent.model = MagicMock()
    agent.instruction = "test instruction"
    agent.tools = []
    return agent


@pytest.fixture
def sample_memory_results():
    """Sample memory search results from mem0."""
    return {
        "results": [
            {
                "memory": "User previously worked on a Python project with authentication",
                "score": 0.95,
                "id": "mem_001"
            },
            {
                "memory": "User prefers JWT tokens for API authentication",
                "score": 0.88,
                "id": "mem_002"
            },
            {
                "memory": "User is familiar with FastAPI framework",
                "score": 0.82,
                "id": "mem_003"
            }
        ]
    }


@pytest.fixture
def mock_search_toolkit():
    """Mock search toolkit for testing."""
    toolkit = MagicMock()
    toolkit.perform_document_search = MagicMock()
    toolkit.preform_all_brain_search = MagicMock()
    toolkit.perform_web_search = MagicMock()
    toolkit.perform_standard_search = MagicMock()
    toolkit.perform_in_memory_extraction = MagicMock()
    toolkit.generate_function.return_value = (MagicMock(), {"name": "test_tool"})
    toolkit.set_in_memory_documents = MagicMock()
    return toolkit

@pytest.fixture
def empty_memory_results():
    """Empty memory search results."""
    return {"results": []}


@pytest.fixture
def mock_chat_request():
    """Mock chat request for testing."""
    request = MagicMock()
    request.message = "test message"
    request.conversation_id = "test-conv-id"
    request.chatbot_name = "test-chatbot"
    return request

@pytest.fixture
def invalid_memory_results():
    """Invalid memory search results (missing memory field)."""
    return {
        "results": [
            {"score": 0.95, "id": "mem_001"},  # Missing memory field
            {"memory": "Valid memory entry", "score": 0.88, "id": "mem_002"}
        ]
    }

@pytest.fixture
def mock_team_request():
    """Mock team request for testing."""
    request = MagicMock()
    request.message = "test team message"
    request.conversation_id = "test-conv-id"
    request.agents = []
    return request

@pytest.fixture
def mock_async_memory():
    """Mock AsyncMemory instance from mem0."""
    mock = AsyncMock()
    mock.search = AsyncMock()
    mock.add = AsyncMock()
    mock.delete = AsyncMock()
    mock.update = AsyncMock()
    return mock



@pytest.fixture
def mock_queue():
    """Mock asyncio queue for testing."""
    queue = MagicMock()
    queue.put = MagicMock()
    return queue


@pytest.fixture
def mock_trace_recorder():
    """Mock trace recorder for testing."""
    recorder = MagicMock()
    recorder.record_chunk = MagicMock()
    recorder.record_function_call = MagicMock()
    recorder.record_function_response = MagicMock()
    recorder.record_error = MagicMock()
    recorder.set_final_result = MagicMock()
    recorder.get_summary = MagicMock(return_value="test summary")
    return recorder


@pytest.fixture
def mock_mcp_toolset():
    """Mock MCP toolset for testing."""
    return MagicMock()


@pytest.fixture
def sample_excel_headers():
    """Sample Excel MCP headers for testing."""
    return {
        "Authorization": "Bearer test-token",
        "Content-Type": "application/json"
    }


@pytest.fixture(scope="function", autouse=True)
def reset_environment():
    """Reset environment variables for each test."""
    import os
    original_env = dict(os.environ)
    yield
    os.environ.clear()
    os.environ.update(original_env)


@pytest.fixture
def mock_logger():
    """Mock logger instance."""
    mock = Mock()
    mock.info = Mock()
    mock.warning = Mock()
    mock.error = Mock()
    mock.exception = Mock()
    return mock


@pytest.fixture
def memory_service_config():
    """Sample memory service configuration."""
    return {
        "vector_store": {
            "provider": "azure_ai_search",
            "config": {
                "service_name": os.getenv("AZURE_AI_SEARCH_SERVICE_NAME", "test-search-service"),
                "collection_name": "test-memory-collection",
                "api_key ": os.getenv("AZURE_AI_SEARCH_API_KEY", "test-search-api-key"),
                "embedding_model_dims": 1536
            },
        },
        "llm": {
            "provider": "litellm",
            "config": {
                "model": os.getenv("MEMORY_MODEL", "gpt-4o-mini"),
                "temperature": 0.0,
                "max_tokens": 4000,
                "api_key": os.getenv("LITELLM_API_SECRET_KEY", "test-litellm-key"),
            }
        },
        "embedder": {
            "provider": "openai",
            "config": {
                "model": os.getenv("EMBEDDING_MODEL", "text-embedding-ada-002"),
                "api_key": os.getenv("LITELLM_API_SECRET_KEY", "test-litellm-key"),
                "openai_base_url": os.getenv("LITELLM_API_BASE_URL", "https://test-litellm-url.com")
            }
        }
    }

@pytest.fixture
def mock_mem0_async_memory():
    """Mock mem0 AsyncMemory class."""
    from unittest.mock import patch
    with patch('src.smart_rag.infrastructure.memory.memory_manager.AsyncMemory') as mock:
        mock_instance = AsyncMock()
        mock.from_config.return_value = mock_instance
        yield mock, mock_instance




@pytest.fixture
def test_config():
    """Test configuration parameters."""
    return {
        "top_k": 10,
        "vectorstore_name": "test-vectorstore",
        "task_order": "test-task-order"
    }


# Mock external dependencies
@pytest.fixture(autouse=True)
def mock_external_deps(monkeypatch):
    """Mock external dependencies that might not be available in test environment."""
    # Mock Google ADK imports
    mock_agent_class = MagicMock()
    mock_agent_instance = MagicMock()
    mock_agent_class.return_value = mock_agent_instance

    mock_mcp_toolset_class = MagicMock()

    monkeypatch.setattr("google.adk.Agent", mock_agent_class)
    monkeypatch.setattr("google.adk.tools.mcp_tool.MCPToolset", mock_mcp_toolset_class)

    # Mock logger
    mock_logger = MagicMock()
    monkeypatch.setattr("src.logger.logging.get_logger", lambda x: mock_logger)

    return {
        "agent_class": mock_agent_class,
        "agent_instance": mock_agent_instance,
        "mcp_toolset_class": mock_mcp_toolset_class,
        "logger": mock_logger
    }

class MockAsyncQueue:
    """Mock async queue implementation for testing."""

    def __init__(self):
        self.items = []

    async def put(self, item):
        await asyncio.sleep(0)
        self.items.append(item)

    async def get(self):
        await asyncio.sleep(0)
        if self.items:
            return self.items.pop(0)
        raise Exception("Queue is empty")

    def qsize(self):
        return len(self.items)

    def empty(self):
        return len(self.items) == 0


@pytest.fixture
def mock_settings():
    from tests.common_schema import MockSettings
    yield MockSettings()


@pytest.fixture
def mock_async_queue():
    """Mock async queue for testing."""
    return MockAsyncQueue()
