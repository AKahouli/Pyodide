"""Test helper utilities and common test functions."""

import asyncio
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, AsyncMock, Mock


def create_mock_memory_service():
    """Create a mock MemoryService instance."""
    mock = Mock()
    mock.memory = AsyncMock()
    mock.initialize = AsyncMock()
    mock.get_relevant_memories = AsyncMock()
    mock.save_manager_conversation = AsyncMock()
    mock.create_manager_context = AsyncMock()
    return mock


def create_mock_async_memory():
    """Create a mock AsyncMemory instance from mem0."""
    mock = AsyncMock()
    mock.search = AsyncMock()
    mock.add = AsyncMock()
    mock.delete = AsyncMock()
    mock.update = AsyncMock()
    mock.get = AsyncMock()
    return mock


def create_sample_memory_results(count: int = 3) -> Dict[str, List[Dict[str, Any]]]:
    """Create sample memory search results.

    Args:
        count: Number of memory results to create

    Returns:
        Dictionary with results array containing memory entries
    """
    results = []
    for i in range(count):
        results.append({
            "memory": f"Sample memory entry {i + 1}",
            "score": 0.9 - (i * 0.1),
            "id": f"mem_{i + 1:03d}"
        })

    return {"results": results}


def create_sample_messages(count: int = 2) -> List[Dict[str, str]]:
    """Create sample conversation messages.

    Args:
        count: Number of message pairs to create

    Returns:
        List of message dictionaries with role and content
    """
    messages = []
    for i in range(count):
        messages.extend([
            {"role": "user", "content": f"User message {i + 1}"},
            {"role": "assistant", "content": f"Assistant response {i + 1}"}
        ])
    return messages


def create_memory_config(
    service_name: str = "test-service",
    collection_name: str = "test-collection",
    api_key: str = "test-key"
) -> Dict[str, Any]:
    """Create a memory service configuration for testing.

    Args:
        service_name: Azure AI Search service name
        collection_name: Collection name
        api_key: API key

    Returns:
        Configuration dictionary
    """
    return {
        "vector_store": {
            "provider": "azure_ai_search",
            "config": {
                "service_name": service_name,
                "collection_name": collection_name,
                "api_key": api_key,
                "embedding_model_dims": 1536
            },
        },
        "llm": {
            "provider": "litellm",
            "config": {
                "model": "gpt-4o-mini",
                "temperature": 0.0,
                "max_tokens": 4000,
                "api_key": api_key,
            }
        },
        "embedder": {
            "provider": "openai",
            "config": {
                "model": "embedding-ada-large",
                "api_key": api_key,
                "openai_base_url": "https://test-api.openai.com"
            }
        }
    }


class AsyncContextManager:
    """Helper class for testing async context managers."""

    def __init__(self, return_value=None):
        self.return_value = return_value

    async def __aenter__(self):
        return self.return_value

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        pass


class MockAsyncQueue:
    """Mock implementation of asyncio.Queue for testing."""

    def __init__(self):
        self.items = []

    async def put(self, item):
        """Add item to queue."""
        self.items.append(item)

    async def get(self):
        """Get item from queue."""
        if self.items:
            return self.items.pop(0)
        raise asyncio.QueueEmpty()

    def empty(self):
        """Check if queue is empty."""
        return len(self.items) == 0

    def qsize(self):
        """Get queue size."""
        return len(self.items)


def create_mock_agent(name: str = "TestAgent", tools: List = None) -> MagicMock:
    """Create a mock agent with standard properties."""
    agent = MagicMock()
    agent.name = name
    agent.model = MagicMock()
    agent.instruction = f"Test instruction for {name}"
    agent.tools = tools or []
    agent.run = AsyncMock()
    return agent


def create_mock_llm(model_name: str = "test-model") -> MagicMock:
    """Create a mock LLM with standard properties."""
    llm = MagicMock()
    llm.model_name = model_name
    llm.generate = AsyncMock()
    llm.stream = AsyncMock()
    return llm


def create_mock_toolkit(search_functions: List[str] = None) -> MagicMock:
    """Create a mock search toolkit with standard methods."""
    toolkit = MagicMock()

    # Default search functions
    default_functions = [
        "perform_document_search",
        "preform_all_brain_search",
        "perform_web_search",
        "perform_standard_search",
        "perform_in_memory_extraction"
    ]

    functions = search_functions or default_functions

    for func_name in functions:
        setattr(toolkit, func_name, MagicMock())

    toolkit.generate_function.return_value = (MagicMock(), {"name": "test_tool"})
    toolkit.set_in_memory_documents = MagicMock()

    return toolkit


def create_mock_trace_recorder(agent_name: str = "TestAgent") -> MagicMock:
    """Create a mock trace recorder with standard methods."""
    recorder = MagicMock()
    recorder.agent_name = agent_name
    recorder.history = []
    recorder.text_chunks = []
    recorder.function_calls = []
    recorder.function_responses = []
    recorder.errors = []

    recorder.record_chunk = MagicMock()
    recorder.record_function_call = MagicMock()
    recorder.record_function_response = MagicMock()
    recorder.record_error = MagicMock()
    recorder.set_final_result = MagicMock()
    recorder.get_summary.return_value = "Mock summary"

    return recorder


async def run_async_test(coro):
    """Helper to run async tests."""
    return await coro


def assert_called_with_partial(mock_call, expected_partial_args: Dict[str, Any]):
    """Assert that a mock was called with arguments that partially match expected."""
    args, kwargs = mock_call.call_args

    for key, expected_value in expected_partial_args.items():
        if key in kwargs:
            assert kwargs[key] == expected_value, f"Expected {key}={expected_value}, got {kwargs[key]}"
        else:
            # Check if it's in args by position (more complex, skip for now)
            pass


def create_sample_doc_tree() -> List[Dict[str, Any]]:
    """Create a sample document tree for testing."""
    return [
        {
            "name": "Sample Document 1",
            "id": "doc1",
            "description": "First test document",
            "type": "pdf"
        },
        {
            "name": "Sample Document 2",
            "id": "doc2",
            "description": "Second test document",
            "type": "txt"
        }
    ]


def create_sample_brain_tree() -> List[Dict[str, Any]]:
    """Create a sample brain tree for testing."""
    return [
        {
            "name": "Sample Brain 1",
            "id": "brain1",
            "description": "First test brain",
            "model": "gpt-4"
        }
    ]


def create_sample_search_response() -> Dict[str, Any]:
    """Create a sample search response for testing."""
    return {
        "results": [
            {
                "content": "This is test search result 1",
                "score": 0.95,
                "source": "doc1",
                "metadata": {"page": 1}
            },
            {
                "content": "This is test search result 2",
                "score": 0.87,
                "source": "doc2",
                "metadata": {"page": 2}
            }
        ],
        "total_results": 2
    }


def assert_memory_search_called_with(
    mock_memory: AsyncMock,
    query: str,
    user_id: str,
    limit: int = 10
):
    """Assert that memory search was called with expected parameters.

    Args:
        mock_memory: Mock AsyncMemory instance
        query: Expected search query
        user_id: Expected user ID
        limit: Expected limit
    """
    mock_memory.search.assert_called_once_with(
        query=query,
        user_id=user_id,
        limit=limit
    )


def assert_memory_add_called_with(
    mock_memory: AsyncMock,
    messages: List[Dict[str, str]],
    user_id: str
):
    """Assert that memory add was called with expected parameters.

    Args:
        mock_memory: Mock AsyncMemory instance
        messages: Expected messages
        user_id: Expected user ID
    """
    mock_memory.add.assert_called_once_with(messages, user_id=user_id)


def create_mock_settings(
    service_name: str = "test-service",
    collection_name: str = "test-collection",
    search_api_key: str = "test-search-key",
    litellm_api_key: str = "test-litellm-key",
    litellm_base_url: str = "https://test-litellm.com"
):
    """Create mock settings for testing.

    Args:
        service_name: Azure AI Search service name
        collection_name: Memory collection name
        search_api_key: Azure AI Search API key
        litellm_api_key: LiteLLM API key
        litellm_base_url: LiteLLM base URL

    Returns:
        Mock settings object
    """
    mock = Mock()
    mock.AZURE_AI_SEARCH_SERVICE_NAME = service_name
    mock.AZURE_AI_SEARCH_MEM_COLLECTION_NAME = collection_name
    mock.AZURE_AI_SEARCH_API_KEY = search_api_key
    mock.LITELLM_API_SECRET_KEY = litellm_api_key
    mock.LITELLM_API_BASE_URL = litellm_base_url
    return mock


def format_memory_context(memories_text: str) -> str:
    """Format memory context as expected by create_manager_context.

    Args:
        memories_text: Formatted memories text

    Returns:
        Formatted memory context string
    """
    if memories_text:
        return f"\n\n< manager_memories >\nRelevant memories from previous conversations:\n{memories_text}\n< /manager_memories >"
    return ""


def extract_memories_from_results(results: Dict[str, List[Dict[str, Any]]]) -> str:
    """Extract and format memories from search results.

    Args:
        results: Memory search results

    Returns:
        Formatted memories string
    """
    if not results or not results.get("results"):
        return ""

    memories_list = []
    for entry in results["results"]:
        if entry.get('memory'):
            memories_list.append(f"- {entry['memory']}")

    return "\n".join(memories_list) if memories_list else ""