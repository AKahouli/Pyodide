"""Tests for chatbot router endpoints."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import HTTPException
from fastapi.testclient import TestClient

from src.schema.chatbot_schema import ConfigAgentsWithSkillsRequest, AgentSuggestion, ClearAgentMemoryRequest, ChatCompletionRequest


@pytest.fixture
def mock_agent_suggestion():
    """Mock AgentSuggestion for testing."""
    return AgentSuggestion(
        id="agent_123",
        name="TestAgent",
        description="A test agent",
        prompt="Test prompt",
        tools=[],
        chatbot_name={"name": "gpt-4o-mini"}
    )


@pytest.fixture
def mock_config_request(mock_agent_suggestion):
    """Mock ConfigAgentsWithSkillsRequest for testing."""
    return ConfigAgentsWithSkillsRequest(
        agent=mock_agent_suggestion,
        skills="Python programming, FastAPI development, Testing"
    )


@pytest.fixture
def mock_current_user():
    """Mock current user for authentication."""
    user = MagicMock()
    user.username = "test_user"
    user.user_id = "user_123"
    return user


class TestConfigAgentsWithSkillsEndpoint:
    """Test cases for config_agents_with_skills endpoint."""

    @pytest.mark.asyncio
    async def test_config_agents_with_skills_success(self, mock_config_request, mock_current_user):
        """Test successful agent skills configuration."""
        with patch('src.routers.chatbot.SkillsService') as MockSkillsService:
            # Setup mock
            mock_service = MagicMock()
            mock_service.initialize = AsyncMock()
            mock_service.save_agent_skills = AsyncMock(return_value=True)
            MockSkillsService.return_value = mock_service

            # Import endpoint after mocking
            from src.routers.chatbot import config_agents_with_skills_endpoint

            # Call endpoint
            result = await config_agents_with_skills_endpoint(
                user_request=mock_config_request,
                current_user=mock_current_user,
                skills_service=mock_service
            )

            # Assertions
            assert result["status"] == "success"
            assert "configured with skills" in result["message"]
            assert result["agent_id"] == "agent_123"
            assert result["agent_name"] == "TestAgent"

            # Verify service calls
            mock_service.initialize.assert_called_once_with()
            mock_service.save_agent_skills.assert_called_once_with(
                agent_id="agent_123",
                agent_name="TestAgent",
                skills="Python programming, FastAPI development, Testing"
            )

    @pytest.mark.asyncio
    async def test_config_agents_with_skills_memory_failure(self, mock_config_request, mock_current_user):
        """Test agent skills configuration when memory save fails."""
        with patch('src.routers.chatbot.SkillsService') as MockSkillsService:
            # Setup mock to return failure
            mock_service = MagicMock()
            mock_service.initialize = AsyncMock()
            mock_service.save_agent_skills = AsyncMock(return_value=False)
            MockSkillsService.return_value = mock_service

            from src.routers.chatbot import config_agents_with_skills_endpoint

            # Should raise HTTPException when memory save fails
            with pytest.raises(HTTPException) as exc_info:
                await config_agents_with_skills_endpoint(
                    user_request=mock_config_request,
                    current_user=mock_current_user,
                    skills_service=mock_service
                )

            assert exc_info.value.status_code == 500
            assert "Failed to save skills to memory" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_config_agents_with_skills_exception(self, mock_config_request, mock_current_user):
        """Test agent skills configuration with unexpected exception."""
        with patch('src.routers.chatbot.SkillsService') as MockSkillsService:
            # Setup mock to raise exception
            mock_service = MagicMock()
            mock_service.initialize = AsyncMock(side_effect=Exception("Database error"))
            MockSkillsService.return_value = mock_service

            from src.routers.chatbot import config_agents_with_skills_endpoint

            # Should raise HTTPException
            with pytest.raises(HTTPException) as exc_info:
                await config_agents_with_skills_endpoint(
                    user_request=mock_config_request,
                    current_user=mock_current_user,
                    skills_service=mock_service
                )

            assert exc_info.value.status_code == 500
            assert "Database error" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_config_agents_with_skills_with_default_chatbot(self, mock_current_user):
        """Test agent skills configuration with default chatbot model."""
        agent = AgentSuggestion(
            id="agent_456",
            name="AgentWithDefaultChatbot",
            description="Test agent with default chatbot",
            prompt="Test prompt",
            tools=[],
            chatbot_name={"name": "gpt-4o-mini"}
        )

        request = ConfigAgentsWithSkillsRequest(
            agent=agent,
            skills="Basic skills"
        )

        with patch('src.routers.chatbot.SkillsService') as MockSkillsService:
            mock_service = MagicMock()
            mock_service.initialize = AsyncMock()
            mock_service.save_agent_skills = AsyncMock(return_value=True)
            MockSkillsService.return_value = mock_service

            from src.routers.chatbot import config_agents_with_skills_endpoint

            result = await config_agents_with_skills_endpoint(
                user_request=request,
                current_user=mock_current_user,
                skills_service=mock_service
            )

            # Should use default model
            mock_service.initialize.assert_called_once_with()
            assert result["status"] == "success"

    @pytest.mark.asyncio
    async def test_config_agents_with_skills_with_empty_skills(self, mock_current_user):
        """Test agent skills configuration with empty skills string."""
        agent = AgentSuggestion(
            id="agent_789",
            name="EmptySkillsAgent",
            description="Agent with empty skills",
            prompt="Test prompt",
            tools=[],
            chatbot_name={"name": "gpt-4o"}
        )

        request = ConfigAgentsWithSkillsRequest(
            agent=agent,
            skills=""
        )

        with patch('src.routers.chatbot.SkillsService') as MockSkillsService:
            mock_service = MagicMock()
            mock_service.initialize = AsyncMock()
            mock_service.save_agent_skills = AsyncMock(return_value=True)
            MockSkillsService.return_value = mock_service

            from src.routers.chatbot import config_agents_with_skills_endpoint

            result = await config_agents_with_skills_endpoint(
                user_request=request,
                current_user=mock_current_user,
                skills_service=mock_service
            )

            # Should still work with empty skills
            assert result["status"] == "success"
            mock_service.save_agent_skills.assert_called_once()

    @pytest.mark.asyncio
    async def test_config_agents_with_skills_with_special_characters(self, mock_current_user):
        """Test agent skills configuration with special characters in skills."""
        agent = AgentSuggestion(
            id="agent_special",
            name="SpecialAgent",
            description="Agent with special chars",
            prompt="Test prompt",
            tools=[],
            chatbot_name={"name": "gpt-4o"}
        )

        skills_with_special_chars = "Python\nFastAPI\t\nTesting & QA\n\"Advanced\" skills"

        request = ConfigAgentsWithSkillsRequest(
            agent=agent,
            skills=skills_with_special_chars
        )

        with patch('src.routers.chatbot.SkillsService') as MockSkillsService:
            mock_service = MagicMock()
            mock_service.initialize = AsyncMock()
            mock_service.save_agent_skills = AsyncMock(return_value=True)
            MockSkillsService.return_value = mock_service

            from src.routers.chatbot import config_agents_with_skills_endpoint

            result = await config_agents_with_skills_endpoint(
                user_request=request,
                current_user=mock_current_user,
                skills_service=mock_service
            )

            assert result["status"] == "success"

            # Verify special characters are passed correctly
            call_args = mock_service.save_agent_skills.call_args
            assert call_args.kwargs["skills"] == skills_with_special_chars

    @pytest.mark.asyncio
    async def test_config_agents_with_skills_logs_error(self, mock_config_request, mock_current_user):
        """Test that errors are logged when exception occurs."""
        with patch('src.routers.chatbot.SkillsService') as MockSkillsService, \
             patch('src.routers.chatbot.logger') as mock_logger:

            mock_service = MagicMock()
            mock_service.initialize = AsyncMock(side_effect=Exception("Test error"))
            MockSkillsService.return_value = mock_service

            from src.routers.chatbot import config_agents_with_skills_endpoint

            with pytest.raises(HTTPException):
                await config_agents_with_skills_endpoint(
                    user_request=mock_config_request,
                    current_user=mock_current_user,
                    skills_service=mock_service
                )

            # Verify error was logged
            mock_logger.error.assert_called_once()
            error_msg = mock_logger.error.call_args[0][0]
            assert "Unexpected error" in error_msg
            assert "config_agents_with_skills" in error_msg


class TestClearAgentMemoryEndpoint:
    """Test cases for clear_agent_memory endpoint."""

    @pytest.fixture
    def mock_clear_memory_request(self):
        """Mock ClearAgentMemoryRequest for testing."""
        return ClearAgentMemoryRequest(agent_id="agent_123")

    @pytest.mark.asyncio
    async def test_clear_agent_memory_success(self, mock_clear_memory_request, mock_current_user):
        """Test successful agent memory clearing."""
        with patch('src.routers.chatbot.MemoryService') as MockMemoryService:
            # Setup mock
            mock_service = MagicMock()
            mock_service.initialize = AsyncMock()
            mock_service.clear_agent_memory = AsyncMock(return_value=True)
            MockMemoryService.return_value = mock_service

            # Import endpoint after mocking
            from src.routers.chatbot import clear_agent_memory_endpoint

            # Call endpoint
            result = await clear_agent_memory_endpoint(
                user_request=mock_clear_memory_request,
                current_user=mock_current_user,
                memory_service=mock_service
            )

            # Assertions
            assert result["status"] == "success"
            assert "Successfully cleared all memories" in result["message"]
            assert result["agent_id"] == "agent_123"

            # Verify service calls
            mock_service.initialize.assert_called_once_with()
            mock_service.clear_agent_memory.assert_called_once_with(agent_id="agent_123")

    @pytest.mark.asyncio
    async def test_clear_agent_memory_failure(self, mock_clear_memory_request, mock_current_user):
        """Test agent memory clearing when clear fails."""
        with patch('src.routers.chatbot.MemoryService') as MockMemoryService:
            # Setup mock to return failure
            mock_service = MagicMock()
            mock_service.initialize = AsyncMock()
            mock_service.clear_agent_memory = AsyncMock(return_value=False)
            MockMemoryService.return_value = mock_service

            from src.routers.chatbot import clear_agent_memory_endpoint

            # Should raise HTTPException when memory clear fails
            with pytest.raises(HTTPException) as exc_info:
                await clear_agent_memory_endpoint(
                    user_request=mock_clear_memory_request,
                    current_user=mock_current_user,
                    memory_service=mock_service
                )

            assert exc_info.value.status_code == 500
            assert "Failed to clear memories for agent" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_clear_agent_memory_exception(self, mock_clear_memory_request, mock_current_user):
        """Test agent memory clearing with unexpected exception."""
        with patch('src.routers.chatbot.MemoryService') as MockMemoryService:
            # Setup mock to raise exception
            mock_service = MagicMock()
            mock_service.initialize = AsyncMock(side_effect=Exception("Memory service error"))
            MockMemoryService.return_value = mock_service

            from src.routers.chatbot import clear_agent_memory_endpoint

            # Should raise HTTPException
            with pytest.raises(HTTPException) as exc_info:
                await clear_agent_memory_endpoint(
                    user_request=mock_clear_memory_request,
                    current_user=mock_current_user,
                    memory_service=mock_service
                )

            assert exc_info.value.status_code == 500
            assert "Memory service error" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_clear_agent_memory_logs_info(self, mock_clear_memory_request, mock_current_user):
        """Test that info is logged when clearing memory."""
        with patch('src.routers.chatbot.MemoryService') as MockMemoryService, \
             patch('src.routers.chatbot.logger') as mock_logger:

            mock_service = MagicMock()
            mock_service.initialize = AsyncMock()
            mock_service.clear_agent_memory = AsyncMock(return_value=True)
            MockMemoryService.return_value = mock_service

            from src.routers.chatbot import clear_agent_memory_endpoint

            await clear_agent_memory_endpoint(
                user_request=mock_clear_memory_request,
                current_user=mock_current_user,
                memory_service=mock_service
            )

            # Verify info was logged
            mock_logger.info.assert_called_once()
            info_msg = mock_logger.info.call_args[0][0]
            assert "Clearing memory for agent" in info_msg
            assert "agent_123" in info_msg

    @pytest.mark.asyncio
    async def test_clear_agent_memory_logs_error(self, mock_clear_memory_request, mock_current_user):
        """Test that errors are logged when exception occurs."""
        with patch('src.routers.chatbot.MemoryService') as MockMemoryService, \
             patch('src.routers.chatbot.logger') as mock_logger:

            mock_service = MagicMock()
            mock_service.initialize = AsyncMock(side_effect=Exception("Test error"))
            MockMemoryService.return_value = mock_service

            from src.routers.chatbot import clear_agent_memory_endpoint

            with pytest.raises(HTTPException):
                await clear_agent_memory_endpoint(
                    user_request=mock_clear_memory_request,
                    current_user=mock_current_user,
                    memory_service=mock_service
                )

            # Verify error was logged
            mock_logger.exception.assert_called_once()
            error_msg = mock_logger.exception.call_args[0][0]
            assert "Unexpected error" in error_msg
            assert "clear_agent_memory" in error_msg

    @pytest.mark.asyncio
    async def test_clear_agent_memory_with_different_agent_id(self, mock_current_user):
        """Test clearing memory for different agent IDs."""
        test_agent_ids = ["agent_456", "search_agent", "manager_agent_789"]

        for agent_id in test_agent_ids:
            request = ClearAgentMemoryRequest(agent_id=agent_id)

            with patch('src.routers.chatbot.MemoryService') as MockMemoryService:
                mock_service = MagicMock()
                mock_service.initialize = AsyncMock()
                mock_service.clear_agent_memory = AsyncMock(return_value=True)
                MockMemoryService.return_value = mock_service

                from src.routers.chatbot import clear_agent_memory_endpoint

                result = await clear_agent_memory_endpoint(
                    user_request=request,
                    current_user=mock_current_user,
                    memory_service=mock_service
                )

                assert result["status"] == "success"
                assert result["agent_id"] == agent_id
                mock_service.clear_agent_memory.assert_called_once_with(agent_id=agent_id)


class TestChatCompletionEndpoint:
    """Test cases for chat_completion endpoint."""

    @pytest.fixture
    def mock_chat_completion_request(self):
        """Mock ChatCompletionRequest for testing."""
        return ChatCompletionRequest(
            message="What is the capital of France?",
            model="gpt-4o-mini",
            temperature=0.7,
            max_tokens=100
        )

    @pytest.mark.asyncio
    async def test_chat_completion_success(self, mock_chat_completion_request, mock_current_user):
        """Test successful chat completion."""
        with patch('src.routers.chatbot.SimpleCompletionService') as MockSimpleCompletionService:
            # Setup mock
            mock_service = MagicMock()
            mock_service.create_completion = AsyncMock(return_value="Paris is the capital of France.")
            MockSimpleCompletionService.return_value = mock_service

            # Import endpoint after mocking
            from src.routers.chatbot import chat_completion_endpoint

            # Call endpoint
            result = await chat_completion_endpoint(
                user_request=mock_chat_completion_request,
                current_user=mock_current_user,
                service=mock_service
            )

            # Assertions
            assert result["status"] == "success"
            assert result["content"] == "Paris is the capital of France."

            # Verify service calls
            mock_service.create_completion.assert_called_once_with(
                message="What is the capital of France?",
                model="gpt-4o-mini",
                temperature=0.7,
                max_tokens=100
            )

    @pytest.mark.asyncio
    async def test_chat_completion_with_default_temperature(self, mock_current_user):
        """Test chat completion with default temperature."""
        request = ChatCompletionRequest(
            message="Hello",
            model="gpt-4o"
        )

        with patch('src.routers.chatbot.SimpleCompletionService') as MockSimpleCompletionService:
            mock_service = MagicMock()
            mock_service.create_completion = AsyncMock(return_value="Hello! How can I help you?")
            MockSimpleCompletionService.return_value = mock_service

            from src.routers.chatbot import chat_completion_endpoint

            result = await chat_completion_endpoint(
                user_request=request,
                current_user=mock_current_user,
                service=mock_service
            )

            assert result["status"] == "success"
            assert result["content"] == "Hello! How can I help you?"

            # Verify default temperature was used
            call_kwargs = mock_service.create_completion.call_args.kwargs
            assert call_kwargs["temperature"] == 0.7

    @pytest.mark.asyncio
    async def test_chat_completion_without_max_tokens(self, mock_current_user):
        """Test chat completion without max_tokens."""
        request = ChatCompletionRequest(
            message="Test message",
            model="gpt-4o-mini"
        )

        with patch('src.routers.chatbot.SimpleCompletionService') as MockSimpleCompletionService:
            mock_service = MagicMock()
            mock_service.create_completion = AsyncMock(return_value="Test response")
            MockSimpleCompletionService.return_value = mock_service

            from src.routers.chatbot import chat_completion_endpoint

            result = await chat_completion_endpoint(
                user_request=request,
                current_user=mock_current_user,
                service=mock_service
            )

            assert result["status"] == "success"

            # Verify max_tokens was None
            call_kwargs = mock_service.create_completion.call_args.kwargs
            assert call_kwargs["max_tokens"] is None

    @pytest.mark.asyncio
    async def test_chat_completion_with_custom_parameters(self, mock_current_user):
        """Test chat completion with custom temperature and max_tokens."""
        request = ChatCompletionRequest(
            message="Explain quantum physics",
            model="gpt-4o",
            temperature=0.2,
            max_tokens=500
        )

        with patch('src.routers.chatbot.SimpleCompletionService') as MockSimpleCompletionService:
            mock_service = MagicMock()
            mock_service.create_completion = AsyncMock(return_value="Quantum physics explanation...")
            MockSimpleCompletionService.return_value = mock_service

            from src.routers.chatbot import chat_completion_endpoint

            result = await chat_completion_endpoint(
                user_request=request,
                current_user=mock_current_user,
                service=mock_service
            )

            assert result["status"] == "success"

            # Verify custom parameters were used
            mock_service.create_completion.assert_called_once_with(
                message="Explain quantum physics",
                model="gpt-4o",
                temperature=0.2,
                max_tokens=500
            )

    @pytest.mark.asyncio
    async def test_chat_completion_validation_error(self, mock_current_user):
        """Test chat completion with validation error."""
        request = ChatCompletionRequest(
            message="Test message",  # Valid message for request validation
            model="gpt-4o-mini"
        )

        with patch('src.routers.chatbot.SimpleCompletionService') as MockSimpleCompletionService:
            mock_service = MagicMock()
            mock_service.create_completion = AsyncMock(side_effect=ValueError("Message must be a non-empty string"))
            MockSimpleCompletionService.return_value = mock_service

            from src.routers.chatbot import chat_completion_endpoint

            # Should raise HTTPException with 500 status (all exceptions caught as 500)
            with pytest.raises(HTTPException) as exc_info:
                await chat_completion_endpoint(
                    user_request=request,
                    current_user=mock_current_user,
                    service=mock_service
                )

            assert exc_info.value.status_code == 500
            assert "Failed to create chat completion" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_chat_completion_service_exception(self, mock_chat_completion_request, mock_current_user):
        """Test chat completion with service exception."""
        with patch('src.routers.chatbot.SimpleCompletionService') as MockSimpleCompletionService:
            mock_service = MagicMock()
            mock_service.create_completion = AsyncMock(
                side_effect=Exception("OpenAI API error: Rate limit exceeded")
            )
            MockSimpleCompletionService.return_value = mock_service

            from src.routers.chatbot import chat_completion_endpoint

            # Should raise HTTPException with 500 status
            with pytest.raises(HTTPException) as exc_info:
                await chat_completion_endpoint(
                    user_request=mock_chat_completion_request,
                    current_user=mock_current_user,
                    service=mock_service
                )

            assert exc_info.value.status_code == 500
            assert "Failed to create chat completion" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_chat_completion_logs_info(self, mock_chat_completion_request, mock_current_user):
        """Test that successful completions are logged."""
        with patch('src.routers.chatbot.SimpleCompletionService') as MockSimpleCompletionService, \
             patch('src.routers.chatbot.logger') as mock_logger:

            mock_service = MagicMock()
            mock_service.create_completion = AsyncMock(return_value="Test response")
            MockSimpleCompletionService.return_value = mock_service

            from src.routers.chatbot import chat_completion_endpoint

            await chat_completion_endpoint(
                user_request=mock_chat_completion_request,
                current_user=mock_current_user,
                service=mock_service
            )

            # Verify info was logged
            mock_logger.info.assert_called_once()
            info_msg = mock_logger.info.call_args[0][0]
            assert "Chat completion request" in info_msg
            assert "test_user" in info_msg
            assert "gpt-4o-mini" in info_msg

    @pytest.mark.asyncio
    async def test_chat_completion_logs_error(self, mock_chat_completion_request, mock_current_user):
        """Test that errors are logged when exception occurs."""
        with patch('src.routers.chatbot.SimpleCompletionService') as MockSimpleCompletionService, \
             patch('src.routers.chatbot.logger') as mock_logger:

            mock_service = MagicMock()
            mock_service.create_completion = AsyncMock(side_effect=Exception("Test error"))
            MockSimpleCompletionService.return_value = mock_service

            from src.routers.chatbot import chat_completion_endpoint

            with pytest.raises(HTTPException):
                await chat_completion_endpoint(
                    user_request=mock_chat_completion_request,
                    current_user=mock_current_user,
                    service=mock_service
                )

            # Verify error was logged
            mock_logger.error.assert_called_once()
            error_msg = mock_logger.error.call_args[0][0]
            assert "Unexpected error" in error_msg
            assert "chat_completion" in error_msg

    @pytest.mark.asyncio
    async def test_chat_completion_with_different_models(self, mock_current_user):
        """Test chat completion with different model names."""
        models = ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"]

        for model in models:
            request = ChatCompletionRequest(
                message="Test message",
                model=model
            )

            with patch('src.routers.chatbot.SimpleCompletionService') as MockSimpleCompletionService:
                mock_service = MagicMock()
                mock_service.create_completion = AsyncMock(return_value="Test response")
                MockSimpleCompletionService.return_value = mock_service

                from src.routers.chatbot import chat_completion_endpoint

                result = await chat_completion_endpoint(
                    user_request=request,
                    current_user=mock_current_user,
                    service=mock_service
                )

                assert result["status"] == "success"

                # Verify correct model was used
                call_kwargs = mock_service.create_completion.call_args.kwargs
                assert call_kwargs["model"] == model

    @pytest.mark.asyncio
    async def test_chat_completion_with_long_message(self, mock_current_user):
        """Test chat completion with a very long message."""
        long_message = "This is a test message. " * 100  # 2500+ characters

        request = ChatCompletionRequest(
            message=long_message,
            model="gpt-4o-mini"
        )

        with patch('src.routers.chatbot.SimpleCompletionService') as MockSimpleCompletionService:
            mock_service = MagicMock()
            mock_service.create_completion = AsyncMock(return_value="Long response")
            MockSimpleCompletionService.return_value = mock_service

            from src.routers.chatbot import chat_completion_endpoint

            result = await chat_completion_endpoint(
                user_request=request,
                current_user=mock_current_user,
                service=mock_service
            )

            assert result["status"] == "success"

            # Verify long message was passed correctly
            call_kwargs = mock_service.create_completion.call_args.kwargs
            assert call_kwargs["message"] == long_message

    @pytest.mark.asyncio
    async def test_chat_completion_with_special_characters(self, mock_current_user):
        """Test chat completion with special characters in message."""
        special_message = "Test with émojis 🚀 and special chars: @#$%^&*()"

        request = ChatCompletionRequest(
            message=special_message,
            model="gpt-4o-mini"
        )

        with patch('src.routers.chatbot.SimpleCompletionService') as MockSimpleCompletionService:
            mock_service = MagicMock()
            mock_service.create_completion = AsyncMock(return_value="Response with special chars")
            MockSimpleCompletionService.return_value = mock_service

            from src.routers.chatbot import chat_completion_endpoint

            result = await chat_completion_endpoint(
                user_request=request,
                current_user=mock_current_user,
                service=mock_service
            )

            assert result["status"] == "success"

            # Verify special characters were preserved
            call_kwargs = mock_service.create_completion.call_args.kwargs
            assert call_kwargs["message"] == special_message

    @pytest.mark.asyncio
    async def test_chat_completion_response_format(self, mock_chat_completion_request, mock_current_user):
        """Test that response has correct format."""
        with patch('src.routers.chatbot.SimpleCompletionService') as MockSimpleCompletionService:
            mock_service = MagicMock()
            mock_service.create_completion = AsyncMock(return_value="Test response content")
            MockSimpleCompletionService.return_value = mock_service

            from src.routers.chatbot import chat_completion_endpoint

            result = await chat_completion_endpoint(
                user_request=mock_chat_completion_request,
                current_user=mock_current_user,
                service=mock_service
            )

            # Verify response structure
            assert isinstance(result, dict)
            assert "status" in result
            assert "content" in result
            assert result["status"] == "success"
            assert isinstance(result["content"], str)

    @pytest.mark.asyncio
    async def test_chat_completion_with_temperature_boundaries(self, mock_current_user):
        """Test chat completion with temperature boundary values."""
        temperatures = [0.0, 1.0, 2.0]

        for temp in temperatures:
            request = ChatCompletionRequest(
                message="Test message",
                model="gpt-4o-mini",
                temperature=temp
            )

            with patch('src.routers.chatbot.SimpleCompletionService') as MockSimpleCompletionService:
                mock_service = MagicMock()
                mock_service.create_completion = AsyncMock(return_value="Response")
                MockSimpleCompletionService.return_value = mock_service

                from src.routers.chatbot import chat_completion_endpoint

                result = await chat_completion_endpoint(
                    user_request=request,
                    current_user=mock_current_user,
                    service=mock_service
                )

                assert result["status"] == "success"

                # Verify temperature was used
                call_kwargs = mock_service.create_completion.call_args.kwargs
                assert call_kwargs["temperature"] == temp