"""Tests for AgentTeamService."""

import pytest
from unittest.mock import AsyncMock, patch

from src.schema.chatbot_schema import RunAgentTeamRequest
from src.smart_rag.core.agent_team_service import AgentTeamService


def make_request(agent_mode: str = "manual") -> RunAgentTeamRequest:
    return RunAgentTeamRequest(
        user_id="user-1",
        session_id="conversation-1",
        message="Analyse ces documents.",
        chatbot_name={"name": "test-model"},
        agent_mode=agent_mode,
    )


class TestAgentTeamService:
    """Test cases for AgentTeamService."""

    def test_init(self):
        """Test service initialization."""
        service = AgentTeamService()
        assert service is not None

    @pytest.mark.asyncio
    @pytest.mark.parametrize("agent_mode", ["mono", "manual", "auto"])
    async def test_process_team_request_uses_user_language_policy(self, agent_mode, mock_queue):
        """All legacy workflows receive the same per-turn language policy."""
        request = make_request(agent_mode)
        with patch('src.smart_rag.core.agent_team_service.run_agent_team_logic') as mock_run_logic:
            mock_run_logic.return_value = AsyncMock()

            service = AgentTeamService()
            await service.process_team_request(request, mock_queue)

            forwarded_request = mock_run_logic.call_args.args[0]
            assert forwarded_request is not request
            assert forwarded_request.message.startswith("Analyse ces documents.\n\n")
            assert "dominant natural language of the original user's request" in forwarded_request.message
            assert "reasoning or thought activity" in forwarded_request.message
            assert "delegated task descriptions and expected outputs" in forwarded_request.message
            assert "search objectives" in forwarded_request.message
            assert "Managers must carry this requirement" in forwarded_request.message
            assert request.message == "Analyse ces documents."
            mock_run_logic.assert_called_once_with(forwarded_request, mock_queue)

    @pytest.mark.asyncio
    async def test_process_team_request_is_repeatable_without_mutating_the_request(self, mock_queue):
        request = make_request()
        with patch('src.smart_rag.core.agent_team_service.run_agent_team_logic') as mock_run_logic:
            service = AgentTeamService()

            await service.process_team_request(request, mock_queue)
            await service.process_team_request(request, mock_queue)

            first = mock_run_logic.call_args_list[0].args[0]
            second = mock_run_logic.call_args_list[1].args[0]
            assert first.message == second.message
            assert first.message.count("<response_language_policy>") == 1
            assert request.message == "Analyse ces documents."

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
