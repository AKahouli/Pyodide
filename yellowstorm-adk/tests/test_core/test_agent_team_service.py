"""Tests for AgentTeamService."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.smart_rag.core.agent_team_service import AgentTeamService


class TestAgentTeamService:
    """Test cases for AgentTeamService."""

    def test_init(self):
        """Test service initialization."""
        service = AgentTeamService()
        assert service is not None

    @pytest.mark.asyncio
    async def test_process_team_request(self, mock_team_request, mock_queue):
        """Test team request processing."""
        with patch('src.smart_rag.core.agent_team_service.run_agent_team_logic') as mock_run_logic:
            mock_run_logic.return_value = AsyncMock()

            service = AgentTeamService()
            await service.process_team_request(mock_team_request, mock_queue)

            mock_run_logic.assert_called_once_with(mock_team_request, mock_queue)

    @pytest.mark.asyncio
    async def test_process_team_request_with_exception(self, mock_team_request, mock_queue):
        """Test team request processing when workflow processor raises an exception."""
        with patch('src.smart_rag.core.agent_team_service.run_agent_team_logic') as mock_run_logic:
            mock_run_logic.side_effect = Exception("Test workflow error")

            service = AgentTeamService()

            with pytest.raises(Exception, match="Test workflow error"):
                await service.process_team_request(mock_team_request, mock_queue)

    def test_service_has_no_state(self):
        """Test service is stateless."""
        service1 = AgentTeamService()
        service2 = AgentTeamService()

        # Services should be independent instances
        assert service1 is not service2