"""Tests for SimpleCompletionService."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from src.smart_rag.core.simple_completion import SimpleCompletionService


@pytest.fixture
def mock_openai_client():
    """Mock OpenAI AsyncClient."""
    mock_client = MagicMock()
    mock_completion = MagicMock()

    # Mock response structure
    mock_choice = MagicMock()
    mock_message = MagicMock()
    mock_message.content = "This is a test response from the assistant."
    mock_message.role = "assistant"
    mock_choice.message = mock_message
    mock_choice.finish_reason = "stop"

    mock_usage = MagicMock()
    mock_usage.prompt_tokens = 10
    mock_usage.completion_tokens = 15
    mock_usage.total_tokens = 25

    mock_completion.id = "chatcmpl-123"
    mock_completion.model = "gpt-4o-mini"
    mock_completion.choices = [mock_choice]
    mock_completion.usage = mock_usage
    mock_completion.created = 1234567890

    # Mock async create method
    mock_client.chat.completions.create = AsyncMock(return_value=mock_completion)

    return mock_client


@pytest.fixture
def simple_completion_service(mock_openai_client):
    """Create SimpleCompletionService with mocked OpenAI client."""
    with patch('src.smart_rag.core.simple_completion.AsyncOpenAI') as MockAsyncOpenAI:
        MockAsyncOpenAI.return_value = mock_openai_client
        service = SimpleCompletionService()
        return service


class TestSimpleCompletionService:
    """Test cases for SimpleCompletionService."""

    @pytest.mark.asyncio
    async def test_create_completion_success(self, simple_completion_service, mock_openai_client):
        """Test successful completion creation."""
        message = "What is the capital of France?"
        model = "gpt-4o-mini"
        temperature = 0
        max_tokens = 100

        result = await simple_completion_service.create_completion(
            message=message,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens
        )

        # Verify result
        assert result == "This is a test response from the assistant."

        # Verify OpenAI client was called correctly
        mock_openai_client.chat.completions.create.assert_called_once()
        call_kwargs = mock_openai_client.chat.completions.create.call_args.kwargs

        assert call_kwargs["model"] == model
        assert call_kwargs["temperature"] == temperature
        assert call_kwargs["max_tokens"] == max_tokens
        assert len(call_kwargs["messages"]) == 2
        assert call_kwargs["messages"][0]["role"] == "system"
        assert call_kwargs["messages"][0]["content"] == "You are a helpful assistant."
        assert call_kwargs["messages"][1]["role"] == "user"
        assert call_kwargs["messages"][1]["content"] == message

    @pytest.mark.asyncio
    async def test_create_completion_with_default_temperature(self, simple_completion_service, mock_openai_client):
        """Test completion with default temperature."""
        message = "Hello"
        model = "gpt-4o"

        result = await simple_completion_service.create_completion(
            message=message,
            model=model
        )

        assert result == "This is a test response from the assistant."

        # Verify default temperature was used
        call_kwargs = mock_openai_client.chat.completions.create.call_args.kwargs
        assert call_kwargs["temperature"] == 0.7

    @pytest.mark.asyncio
    async def test_create_completion_without_max_tokens(self, simple_completion_service, mock_openai_client):
        """Test completion without max_tokens parameter."""
        message = "Test message"
        model = "gpt-4o-mini"

        result = await simple_completion_service.create_completion(
            message=message,
            model=model
        )

        assert result == "This is a test response from the assistant."

        # Verify max_tokens was not included in the call
        call_kwargs = mock_openai_client.chat.completions.create.call_args.kwargs
        assert "max_tokens" not in call_kwargs

    @pytest.mark.asyncio
    async def test_create_completion_with_max_tokens(self, simple_completion_service, mock_openai_client):
        """Test completion with max_tokens parameter."""
        message = "Test message"
        model = "gpt-4o-mini"
        max_tokens = 500

        result = await simple_completion_service.create_completion(
            message=message,
            model=model,
            max_tokens=max_tokens
        )

        assert result == "This is a test response from the assistant."

        # Verify max_tokens was included in the call
        call_kwargs = mock_openai_client.chat.completions.create.call_args.kwargs
        assert call_kwargs["max_tokens"] == max_tokens

    @pytest.mark.asyncio
    async def test_create_completion_empty_message_raises_error(self, simple_completion_service):
        """Test that empty message raises ValueError."""
        with pytest.raises(ValueError) as exc_info:
            await simple_completion_service.create_completion(
                message="",
                model="gpt-4o-mini"
            )

        assert "Message must be a non-empty string" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_create_completion_invalid_message_type_raises_error(self, simple_completion_service):
        """Test that invalid message type raises ValueError."""
        with pytest.raises(ValueError) as exc_info:
            await simple_completion_service.create_completion(
                message=None,
                model="gpt-4o-mini"
            )

        assert "Message must be a non-empty string" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_create_completion_empty_model_raises_error(self, simple_completion_service):
        """Test that empty model raises ValueError."""
        with pytest.raises(ValueError) as exc_info:
            await simple_completion_service.create_completion(
                message="Test message",
                model=""
            )

        assert "Model must be a non-empty string" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_create_completion_invalid_model_type_raises_error(self, simple_completion_service):
        """Test that invalid model type raises ValueError."""
        with pytest.raises(ValueError) as exc_info:
            await simple_completion_service.create_completion(
                message="Test message",
                model=None
            )

        assert "Model must be a non-empty string" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_create_completion_openai_api_error(self, simple_completion_service, mock_openai_client):
        """Test handling of OpenAI API errors."""
        # Mock API error
        mock_openai_client.chat.completions.create = AsyncMock(
            side_effect=Exception("API rate limit exceeded")
        )

        with pytest.raises(Exception) as exc_info:
            await simple_completion_service.create_completion(
                message="Test message",
                model="gpt-4o-mini"
            )

        assert "OpenAI API error" in str(exc_info.value)
        assert "API rate limit exceeded" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_create_completion_with_different_models(self, simple_completion_service, mock_openai_client):
        """Test completion with different model names."""
        models = ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"]

        for model in models:
            result = await simple_completion_service.create_completion(
                message="Test message",
                model=model
            )

            assert result == "This is a test response from the assistant."

            # Verify correct model was used
            call_kwargs = mock_openai_client.chat.completions.create.call_args.kwargs
            assert call_kwargs["model"] == model

    @pytest.mark.asyncio
    async def test_create_completion_with_different_temperatures(self, simple_completion_service, mock_openai_client):
        """Test completion with different temperature values."""
        temperatures = [0.0, 0.5, 1.0, 1.5, 2.0]

        for temp in temperatures:
            result = await simple_completion_service.create_completion(
                message="Test message",
                model="gpt-4o-mini",
                temperature=temp
            )

            assert result == "This is a test response from the assistant."

            # Verify correct temperature was used
            call_kwargs = mock_openai_client.chat.completions.create.call_args.kwargs
            assert call_kwargs["temperature"] == temp

    @pytest.mark.asyncio
    async def test_create_completion_normalizes_gpt5_temperature(self, simple_completion_service, mock_openai_client):
        """GPT-5 model groups reject temperature values other than 1."""
        result = await simple_completion_service.create_completion(
            message="Test message",
            model="gpt-5.4-nano",
            temperature=0.0,
        )

        assert result == "This is a test response from the assistant."
        call_kwargs = mock_openai_client.chat.completions.create.call_args.kwargs
        assert call_kwargs["temperature"] == 1

    @pytest.mark.asyncio
    async def test_create_completion_with_long_message(self, simple_completion_service, mock_openai_client):
        """Test completion with a very long message."""
        long_message = "This is a test message. " * 100  # 2500+ characters

        result = await simple_completion_service.create_completion(
            message=long_message,
            model="gpt-4o-mini"
        )

        assert result == "This is a test response from the assistant."

        # Verify message was passed correctly
        call_kwargs = mock_openai_client.chat.completions.create.call_args.kwargs
        assert call_kwargs["messages"][1]["content"] == long_message

    @pytest.mark.asyncio
    async def test_create_completion_with_special_characters(self, simple_completion_service, mock_openai_client):
        """Test completion with special characters in message."""
        special_message = "Test with émojis 🚀 and special chars: @#$%^&*()"

        result = await simple_completion_service.create_completion(
            message=special_message,
            model="gpt-4o-mini"
        )

        assert result == "This is a test response from the assistant."

        # Verify special characters were preserved
        call_kwargs = mock_openai_client.chat.completions.create.call_args.kwargs
        assert call_kwargs["messages"][1]["content"] == special_message

    @pytest.mark.asyncio
    async def test_create_completion_system_prompt_included(self, simple_completion_service, mock_openai_client):
        """Test that system prompt is always included."""
        result = await simple_completion_service.create_completion(
            message="Test",
            model="gpt-4o-mini"
        )

        assert result == "This is a test response from the assistant."

        # Verify system prompt is present
        call_kwargs = mock_openai_client.chat.completions.create.call_args.kwargs
        messages = call_kwargs["messages"]
        assert messages[0]["role"] == "system"
        assert messages[0]["content"] == "You are a helpful assistant."

    @pytest.mark.asyncio
    async def test_create_completion_logs_info(self, simple_completion_service, mock_openai_client):
        """Test that successful completions are logged."""
        with patch('src.smart_rag.core.simple_completion.logger') as mock_logger:
            result = await simple_completion_service.create_completion(
                message="Test message",
                model="gpt-4o-mini"
            )

            assert result == "This is a test response from the assistant."

            # Verify logging calls
            assert mock_logger.info.call_count >= 2
            # Check that model info was logged
            log_calls = [call[0][0] for call in mock_logger.info.call_args_list]
            assert any("gpt-4o-mini" in call for call in log_calls)

    @pytest.mark.asyncio
    async def test_create_completion_logs_error_on_failure(self, simple_completion_service, mock_openai_client):
        """Test that errors are logged when completion fails."""
        with patch('src.smart_rag.core.simple_completion.logger') as mock_logger:
            # Mock API error
            mock_openai_client.chat.completions.create = AsyncMock(
                side_effect=Exception("API error")
            )

            with pytest.raises(Exception):
                await simple_completion_service.create_completion(
                    message="Test message",
                    model="gpt-4o-mini"
                )

            # Verify error was logged
            mock_logger.error.assert_called()
            error_msg = mock_logger.error.call_args[0][0]
            assert "Error in create_completion" in error_msg

    @pytest.mark.asyncio
    async def test_service_initialization(self):
        """Test that service initializes correctly with settings."""
        with patch('src.smart_rag.core.simple_completion.AsyncOpenAI') as MockAsyncOpenAI:
            # Create service - it will use settings from conftest.py
            service = SimpleCompletionService()

            # Verify AsyncOpenAI was called (settings come from mock_settings_global fixture)
            MockAsyncOpenAI.assert_called_once()
            call_kwargs = MockAsyncOpenAI.call_args.kwargs
            assert "base_url" in call_kwargs
            assert "api_key" in call_kwargs
