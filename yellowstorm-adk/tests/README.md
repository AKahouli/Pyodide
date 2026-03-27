# SmartRAG Test Suite

This directory contains comprehensive unit tests for the SmartRAG module using pytest.

## Structure

```
tests/
├── __init__.py                     # Test package init
├── conftest.py                     # Pytest configuration and fixtures
├── README.md                       # This file
├── utils/                          # Test utilities
│   ├── __init__.py
│   └── test_helpers.py            # Common test helpers and mocks
├── test_core/                      # Core module tests
│   ├── __init__.py
│   ├── test_chat_rag_service.py   # ChatRAGService tests
│   └── test_agent_team_service.py # AgentTeamService tests
├── test_agents/                    # Agent module tests
│   ├── __init__.py
│   └── test_factories/            # Factory tests
│       ├── __init__.py
│       └── test_base_factory.py   # AgentFactory tests
├── test_infrastructure/            # Infrastructure tests
│   ├── __init__.py
│   └── test_monitoring/           # Monitoring tests
│       ├── __init__.py
│       └── test_trace_recorder.py # TraceRecorder tests
└── test_tools/                     # Tools tests
    ├── __init__.py
    └── test_search/               # Search tools tests
        ├── __init__.py
        └── test_toolkit.py       # SearchToolkit tests
```

## Configuration

- **pytest.ini**: Main pytest configuration with coverage settings
- **conftest.py**: Shared fixtures and test configuration

## Key Features

- **Comprehensive Coverage**: Tests for core services, agents, infrastructure, and tools
- **Mock External Dependencies**: Properly mocks Google ADK, LLM services, and other external dependencies
- **Async Support**: Full support for testing async functions and coroutines
- **Fixtures**: Rich set of reusable fixtures for common test scenarios
- **Test Utilities**: Helper functions for creating mocks and test data

## Running Tests

### Run all tests
```bash
pytest
```

### Run with coverage
```bash
pytest --cov=src/smart_rag --cov-report=html
```

### Run specific test modules
```bash
pytest tests/test_core/
pytest tests/test_agents/test_factories/
```

### Run with specific markers
```bash
pytest -m unit          # Run only unit tests
pytest -m integration   # Run only integration tests
pytest -m "not slow"    # Skip slow tests
```

### Verbose output
```bash
pytest -v
```

## Test Categories

Tests are organized by markers:

- **unit**: Fast, isolated unit tests
- **integration**: Tests that involve multiple components
- **slow**: Long-running tests
- **external**: Tests requiring external services (typically mocked)

## Fixtures

Key fixtures available in `conftest.py`:

- `mock_llm_factory`: Mock LLM factory
- `mock_prompt_processor`: Mock prompt processor
- `mock_agent`: Mock agent instance
- `mock_search_toolkit`: Mock search toolkit
- `sample_doc_tree`: Sample document tree data
- `sample_brain_tree`: Sample brain tree data
- `mock_queue`: Mock async queue

## Test Helpers

The `tests/utils/test_helpers.py` module provides utilities:

- `create_mock_agent()`: Create mock agent instances
- `create_mock_llm()`: Create mock LLM instances
- `create_mock_toolkit()`: Create mock search toolkits
- `MockAsyncQueue`: Mock async queue implementation
- Sample data creators for testing

## Coverage Goals

- Minimum 80% coverage (configured in pytest.ini)
- Focus on critical business logic
- Mock external dependencies appropriately
- Test error conditions and edge cases

## Best Practices

1. **Isolation**: Each test should be independent
2. **Mocking**: Mock external dependencies and slow operations
3. **Descriptive Names**: Use clear, descriptive test names
4. **Arrange-Act-Assert**: Follow the AAA pattern
5. **Fixtures**: Use fixtures for common setup
6. **Parametrization**: Use `@pytest.mark.parametrize` for multiple test cases

## Adding New Tests

When adding new tests:

1. Follow the existing directory structure
2. Use appropriate fixtures from `conftest.py`
3. Add new fixtures to `conftest.py` if needed
4. Include both positive and negative test cases
5. Test async functions with `@pytest.mark.asyncio`
6. Add appropriate markers (`@pytest.mark.unit`, etc.)

## Example Test

```python
@pytest.mark.unit
@pytest.mark.asyncio
async def test_process_request(mock_service, mock_queue, sample_request):
    \"\"\"Test request processing with valid input.\"\"\"
    # Arrange
    expected_result = "test result"
    mock_service.process.return_value = expected_result

    # Act
    result = await service.process_request(sample_request, mock_queue)

    # Assert
    assert result == expected_result
    mock_service.process.assert_called_once_with(sample_request, mock_queue)
```