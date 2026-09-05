"""Extended AgentFactory coverage for diagram tools and connector workspace resolution."""

from unittest.mock import MagicMock, Mock, patch

import pytest
from google.adk import Agent
from google.adk.tools.agent_tool import AgentTool

from src.smart_rag.agents.factories.base_factory import AgentFactory
from src.smart_rag.infrastructure.factories import LLMFactory
from src.smart_rag.infrastructure.processing import PromptProcessor
from src.smart_rag.infrastructure.processing import prepare_web_preview_after_tool


@pytest.fixture
def agent_factory():
    prompt_processor = Mock(spec=PromptProcessor)
    prompt_processor.extract_chatbot_name_and_clean_prompt.side_effect = (
        lambda prompt, chatbot_name=None: (f"cleaned_{prompt}", chatbot_name or "default")
    )
    llm_factory = Mock(spec=LLMFactory)
    llm_factory.create_parallel_tool_calls_llm.return_value = "parallel_llm"
    llm_factory.create_no_tool_calls_llm.return_value = "no_tool_llm"
    llm_factory.create_no_parallel_tool_calls_llm.return_value = "no_parallel_llm"
    factory = AgentFactory(prompt_processor, llm_factory)
    factory.set_diagram_tool_config({"instructions": "Draw diagrams", "prompt": "\nUse diagrams when helpful."})
    return factory


class TestBaseFactoryExtended:
    def test_resolve_connector_workspace_id_prefers_selected_conversation_workspace(self):
        workspace_id = AgentFactory._resolve_connector_workspace_id(
            "conversation-brain",
            [{"workspace_id": "doc-workspace"}],
        )
        assert workspace_id == "conversation-brain"

    def test_resolve_connector_workspace_id_falls_back_to_document(self):
        workspace_id = AgentFactory._resolve_connector_workspace_id(
            None,
            [{"workspace_id": "doc-workspace"}],
        )
        assert workspace_id == "doc-workspace"

    def test_create_html_diagram_tool(self, agent_factory):
        with patch.object(agent_factory, "create_html_diagram_agent", return_value=MagicMock()):
            tool = agent_factory._create_html_diagram_tool("gpt-4o", "Draw charts")
        assert isinstance(tool, AgentTool)

    def test_create_html_diagram_agent(self, agent_factory):
        agent = agent_factory.create_html_diagram_agent(
            instructions="Diagram instructions",
            chatbot_name="gpt-4o",
            name="DiagramAgent",
        )
        assert isinstance(agent, Agent)
        assert agent.name == "DiagramAgent"
        assert agent.model == "no_tool_llm"

    def test_web_preview_disables_model_retries(self, agent_factory):
        agent_factory.set_web_preview_tool_config({
            "instructions": "Return complete HTML.",
            "description": "Generate a web preview.",
        })

        agent_factory.create_web_preview_tool("gpt-4o")

        agent_factory.llm_factory.create_no_tool_calls_llm.assert_called_once_with(
            "gpt-4o", temperature=0.0, num_retries=0
        )

    def test_html_diagram_agent_preserves_omitted_temperature(self, agent_factory):
        agent_factory.create_agent(
            name="DiagramAgent",
            prompt="Create a diagram",
            chatbot_name="gpt-5.4-mini",
            html_design=True,
            temperature=None,
        )

        agent_factory.llm_factory.create_no_tool_calls_llm.assert_any_call(
            "gpt-5.4-mini", temperature=None
        )

    def test_create_agent_with_in_memory_tool(self, agent_factory):
        mock_tools = [MagicMock()]
        with patch.object(
            agent_factory.tool_factory, "create_in_memory_tools", return_value=(mock_tools, MagicMock())
        ):
            agent = agent_factory.create_agent(
                name="MemoryAgent",
                prompt="Use memory",
                chatbot_name="gpt-4o",
                in_memory_tool=True,
                doc_tree=["doc1"],
                brain_ids=["brain1"],
            )
        assert isinstance(agent, Agent)
        assert mock_tools[0] in agent.tools

    def test_create_agent_with_formviz(self, agent_factory):
        agent = agent_factory.create_agent(
            name="VizAgent",
            prompt="Visualize",
            chatbot_name="gpt-4o",
            formviz_tool=True,
        )
        assert isinstance(agent, Agent)
        assert len(agent.tools) == 1

    def test_create_agent_with_code_interpreter(self, agent_factory):
        with patch(
            "src.smart_rag.agents.factories.base_factory.python_interpreter",
            new=MagicMock(name="python_interpreter"),
        ) as mock_python, patch(
            "src.smart_rag.agents.factories.base_factory.MCPHelper.create_toolsets",
            return_value=[MagicMock()],
        ):
            agent = agent_factory.create_agent(
                name="Operator",
                prompt="Run code",
                chatbot_name="gpt-4o",
                code_interpreter_tool=True,
                session_id="sess-1",
                brain_ids=["brain1"],
            )
        assert mock_python in agent.tools

    def test_create_agent_with_html_design(self, agent_factory):
        with patch.object(agent_factory, "_create_html_diagram_tool", return_value=MagicMock()):
            agent = agent_factory.create_agent(
                name="Designer",
                prompt="Design",
                chatbot_name="gpt-4o",
                html_design=True,
            )
        assert isinstance(agent, Agent)
        assert len(agent.tools) == 1

    def test_create_standard_agent_with_web_preview_tool(self, agent_factory):
        agent_factory.set_web_preview_tool_config({
            "prompt": "\nUse the preview tool when useful.",
            "instructions": "Return complete HTML.",
        })

        agent = agent_factory.create_agent(
            name="Worker",
            prompt="Help the user",
            chatbot_name="gpt-4o",
            generate_web_preview=True,
        )

        assert agent.name == "Worker"
        assert [tool.name for tool in agent.tools] == ["generate_web_preview"]
        assert "Use the preview tool" in agent.instruction
        assert prepare_web_preview_after_tool in agent.after_tool_callback
