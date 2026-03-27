"""Tests for SkillsService."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.smart_rag.core.skills_service import SkillsService


class TestSkillsService:
    """Test cases for SkillsService."""

    def test_init(self):
        """Test service initialization."""
        service = SkillsService()
        assert service is not None
        assert service.memory_service is not None
        assert service._settings is not None
        assert service._logger is not None

    def test_init_with_custom_settings(self, mock_settings):
        """Test service initialization with custom settings."""
        service = SkillsService(settings=mock_settings)
        assert service._settings == mock_settings

    @pytest.mark.asyncio
    async def test_initialize(self):
        """Test service initialization with LLM model."""
        service = SkillsService()

        with patch.object(service.memory_service, 'initialize', new_callable=AsyncMock) as mock_init:
            await service.initialize()
            mock_init.assert_called_once_with()

    @pytest.mark.asyncio
    async def test_initialize_default_model(self):
        """Test service initialization with default LLM model."""
        service = SkillsService()

        with patch.object(service.memory_service, 'initialize', new_callable=AsyncMock) as mock_init:
            await service.initialize()
            mock_init.assert_called_once_with()

    def test_build_messages_from_skills(self):
        """Test building messages from skills context."""
        service = SkillsService()

        skills = "Python programming, FastAPI development, Testing"
        agent_name = "TestAgent"

        messages = service._build_messages_from_skills(skills, agent_name)

        assert len(messages) == 1
        assert messages[0]["role"] == "user"
        assert agent_name in messages[0]["content"]
        assert skills in messages[0]["content"]

    def test_build_messages_from_skills_empty_skills(self):
        """Test building messages with empty skills."""
        service = SkillsService()

        messages = service._build_messages_from_skills("", "TestAgent")

        assert len(messages) == 1
        assert messages[0]["role"] == "user"

    @pytest.mark.asyncio
    async def test_save_agent_skills_success(self):
        """Test successful agent skills saving."""
        service = SkillsService()

        with patch.object(service.memory_service, 'save_agent_conversation', new_callable=AsyncMock) as mock_save:
            mock_save.return_value = True

            result = await service.save_agent_skills(
                agent_id="agent_123",
                agent_name="TestAgent",
                skills="Python, FastAPI, Testing"
            )

            assert result is True
            mock_save.assert_called_once()

            # Check that messages were passed correctly
            call_args = mock_save.call_args
            assert call_args.kwargs["agent_id"] == "agent_123"
            assert len(call_args.kwargs["messages"]) == 1

    @pytest.mark.asyncio
    async def test_save_agent_skills_failure(self):
        """Test failed agent skills saving."""
        service = SkillsService()

        with patch.object(service.memory_service, 'save_agent_conversation', new_callable=AsyncMock) as mock_save:
            mock_save.return_value = False

            result = await service.save_agent_skills(
                agent_id="agent_123",
                agent_name="TestAgent",
                skills="Python, FastAPI"
            )

            assert result is False

    @pytest.mark.asyncio
    async def test_save_agent_skills_exception(self):
        """Test agent skills saving with exception."""
        service = SkillsService()

        with patch.object(service.memory_service, 'save_agent_conversation', new_callable=AsyncMock) as mock_save:
            mock_save.side_effect = Exception("Database connection error")

            result = await service.save_agent_skills(
                agent_id="agent_123",
                agent_name="TestAgent",
                skills="Python, FastAPI"
            )

            assert result is False

    @pytest.mark.asyncio
    async def test_save_agent_skills_with_special_characters(self):
        """Test saving skills with special characters."""
        service = SkillsService()

        skills = "Python\nFastAPI\t\nTesting & QA\n\"Advanced\" skills"

        with patch.object(service.memory_service, 'save_agent_conversation', new_callable=AsyncMock) as mock_save:
            mock_save.return_value = True

            result = await service.save_agent_skills(
                agent_id="agent_123",
                agent_name="TestAgent",
                skills=skills
            )

            assert result is True
            # Verify special characters are preserved in messages
            call_args = mock_save.call_args
            assert skills in call_args.kwargs["messages"][0]["content"]

    def test_service_has_no_shared_state(self):
        """Test that service instances are independent."""
        service1 = SkillsService()
        service2 = SkillsService()

        assert service1 is not service2
        assert service1.memory_service is not service2.memory_service