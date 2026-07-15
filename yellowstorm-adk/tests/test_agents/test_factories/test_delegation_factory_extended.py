"""Extended unit tests for AgentDelegationFactory."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.smart_rag.agents.factories.delegation_factory import AgentDelegationFactory


def _factory(**overrides):
    config = SimpleNamespace(
        session_id="sess-1",
        user_id="user-1",
        brain_ids=["b1"],
        attached_images=[{"filename": "chart.png"}],
        **overrides,
    )
    return AgentDelegationFactory(
        config,
        agent_factory=MagicMock(),
        agent_runner=MagicMock(),
        agent_repository=MagicMock(),
        agent_helper=MagicMock(),
        tool_description_provider=MagicMock(),
        citation_manager=MagicMock(),
    )


class TestDelegationFactoryExtended:
    def test_build_delegate_doc(self):
        factory = _factory()
        doc = factory._build_delegate_doc("SearchAgent", "Finds documents")
        assert "SearchAgent" in doc
        assert "delegate" in doc.lower()

    @pytest.mark.asyncio
    async def test_create_agent_with_error_handling_missing_config(self):
        factory = _factory()
        span = MagicMock()
        agent, toolkit = await factory._create_agent_with_error_handling(
            None, "Missing", "missing", "1", span, False, MagicMock()
        )
        assert agent is None
        span.update.assert_called()

    @pytest.mark.asyncio
    async def test_create_agent_with_error_handling_success(self):
        factory = _factory()
        factory._helper.normalize_agent_name.return_value = "search_agent"
        factory.agent_repository.get_agent_by_name.return_value = {
            "tools": ["search"],
            "save_memory": False,
        }
        factory._tool_provider = MagicMock()
        with patch(
            "src.smart_rag.agents.factories.delegation_factory.create_enhanced_prompt",
            return_value="enhanced",
        ), patch(
            "src.smart_rag.agents.factories.delegation_factory.normalize_tools",
            return_value=["search"],
        ), patch(
            "src.smart_rag.agents.factories.delegation_factory.extract_tool_names",
            return_value=["search"],
        ), patch(
            "src.smart_rag.agents.factories.delegation_factory._build_mcp_context_note",
            return_value="<mcp/>",
        ), patch(
            "src.smart_rag.agents.factories.delegation_factory.create_agent_for_delegation",
            return_value=(MagicMock(), MagicMock()),
        ):
            agent, toolkit = await factory._create_agent_with_error_handling(
                {"tools": ["search"]},
                "SearchAgent",
                "search_agent",
                "1",
                MagicMock(),
                False,
                MagicMock(),
            )
        assert agent is not None
        assert toolkit is not None

    @pytest.mark.asyncio
    async def test_execute_agent_with_error_handling_success(self):
        factory = _factory()
        factory.agent_runner.run_agent_tool = AsyncMock(
            return_value=("ok", [], {"execution_flow": [], "execution_statistics": {}}, [])
        )
        span = MagicMock()
        with patch(
            "src.smart_rag.agents.factories.delegation_factory.InMemorySessionService",
            return_value=MagicMock(),
        ):
            result = await factory._execute_agent_with_error_handling(
                MagicMock(),
                {"tools": []},
                "task",
                "expected",
                "1",
                span,
                AsyncMock(),
                "SearchAgent",
                "agent-1",
                MagicMock(),
            )
        assert result == "ok"

    @pytest.mark.asyncio
    async def test_execute_agent_with_error_handling_failure(self):
        factory = _factory()
        factory.agent_runner.run_agent_tool = AsyncMock(side_effect=RuntimeError("boom"))
        span = MagicMock()
        with patch(
            "src.smart_rag.agents.factories.delegation_factory.InMemorySessionService",
            return_value=MagicMock(),
        ):
            result = await factory._execute_agent_with_error_handling(
            MagicMock(),
            {"tools": []},
            "task",
            "expected",
            "1",
            span,
            AsyncMock(),
            "SearchAgent",
                "agent-1",
                None,
            )
        assert result is None
        span.event.assert_called()

    @pytest.mark.asyncio
    async def test_delegate_execution_with_images(self):
        factory = _factory()
        factory._image_input = [{"img": "data:image/png;base64,abc"}]
        factory.agent_repository.get_agent_by_name.return_value = {
            "description": "Search",
            "tools": ["search"],
        }
        factory._helper.normalize_agent_name.return_value = "search_agent"
        factory.agent_repository.get_agent_id_by_name.return_value = "a1"
        factory._create_agent_with_error_handling = AsyncMock(return_value=(MagicMock(), MagicMock()))
        factory._execute_agent_with_error_handling = AsyncMock(return_value="done")
        with patch("src.smart_rag.agents.factories.delegation_factory.langfuse_client") as mock_lf:
            mock_lf.span.return_value = MagicMock()
            delegate = factory.make_delegate_function("SearchAgent", AsyncMock(), False, MagicMock())
            result = await delegate("task ##original_expected_output##table##/original_expected_output##", "1", True)
        assert result == "done"
        kwargs = factory._execute_agent_with_error_handling.await_args.kwargs
        assert kwargs["image_input"] is not None

    @pytest.mark.asyncio
    async def test_delegate_execution_runs_required_temporary_child_first(self):
        factory = _factory()
        factory.agent_repository.get_agent_by_name.return_value = {
            "id": "search-1",
            "name": "SearchAgent",
            "description": "Search",
            "prompt": "Search prompt",
            "tools": [{"name": "search"}],
            "agent_params": {
                "enable_temporary_child_agents": "true",
                "max_temporary_child_agents": "2",
            },
        }
        factory._helper.normalize_agent_name.return_value = "search_agent"
        factory.agent_repository.get_agent_id_by_name.return_value = "search-1"
        mock_agent = MagicMock()
        mock_agent.instruction = "Parent instruction"
        mock_agent.tools = []
        factory._create_agent_with_error_handling = AsyncMock(return_value=(mock_agent, MagicMock()))
        factory._execute_agent_with_error_handling = AsyncMock(
            side_effect=["child evidence", "parent result"]
        )

        with patch("src.smart_rag.agents.factories.delegation_factory.langfuse_client") as mock_lf:
            mock_lf.span.return_value = MagicMock()
            delegate = factory.make_delegate_function("SearchAgent", AsyncMock(), False, MagicMock())
            result = await delegate("parent task", "expected output")

        assert result == "parent result"
        assert mock_agent.tools
        assert len(mock_agent.tools) == 1
        assert mock_agent.tools[0].__name__ == "create_temporary_child_agent"
        assert factory._execute_agent_with_error_handling.await_count == 2
        child_call, parent_call = factory._execute_agent_with_error_handling.await_args_list
        assert "required first temporary-child pass" in child_call.args[2]
        assert "<required_temporary_child_result>" in parent_call.args[2]
        assert "child evidence" in parent_call.args[2]
