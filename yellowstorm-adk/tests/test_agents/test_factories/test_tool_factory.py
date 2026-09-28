"""Unit tests for ToolFactory."""

from unittest.mock import MagicMock, patch

import pytest

from src.smart_rag.agents.factories.tool_factory import ToolFactory
from src.smart_rag.tools.utilities import calculator


@pytest.fixture
def tool_factory():
    return ToolFactory()


class TestToolFactory:
  @patch("src.smart_rag.agents.factories.base_factory.SearchToolkit")
  @patch("src.smart_rag.agents.factories.base_factory.construct_json")
  @patch("src.smart_rag.agents.factories.base_factory.generate_brain_tree_schema")
  def test_create_tools_for_agent_with_search(
      self, mock_brain_schema, mock_construct_json, mock_toolkit_cls, tool_factory
  ):
    mock_construct_json.return_value = ({"q": "str"}, {"doc": "map"}, [])
    mock_brain_schema.return_value = ({"bq": "str"}, {"brain": "map"}, [])
    mock_toolkit = MagicMock()
    mock_toolkit.generate_function.side_effect = [
      (MagicMock(), {"function": {"name": "doc_search"}}),
      (MagicMock(), {"function": {"name": "brain_search"}}),
    ]
    mock_toolkit.perform_web_search = MagicMock()
    mock_toolkit_cls.return_value = mock_toolkit

    tools = tool_factory.create_tools_for_agent(
      doc_tree=[{"name": "Doc", "id": "d1"}],
      brain_tree=[{"name": "Brain", "id": "b1"}],
      brain_ids=["brain-1"],
      top_k=5,
      vectorstore_name="vs",
      calculator_tool=True,
      search_tool=True,
      search_web_tool=True,
    )

    assert calculator in tools
    assert len(tools) >= 2
    mock_construct_json.assert_called_once()
    mock_toolkit_cls.assert_called_once()

  @patch("src.smart_rag.agents.factories.base_factory.SearchToolkit")
  def test_create_tools_for_agent_standalone_web_search(
      self, mock_toolkit_cls, tool_factory
  ):
    mock_toolkit = MagicMock()
    mock_toolkit.perform_web_search = "web_search_fn"
    mock_toolkit_cls.return_value = mock_toolkit

    tools = tool_factory.create_tools_for_agent(
      doc_tree=None,
      brain_tree=None,
      brain_ids=["brain-1"],
      top_k=4,
      vectorstore_name="vs",
      search_web_tool=True,
      search_tool=False,
    )

    assert tools == ["web_search_fn"]
    mock_toolkit_cls.assert_called_once()

  @patch.object(ToolFactory, "create_search_tools")
  def test_create_tools_from_config_processes_search_and_calculator(
      self, mock_create_search, tool_factory
  ):
    mock_create_search.return_value = ([MagicMock()], MagicMock())
    tool_configs = [
      {"name": "search", "top_k": 8},
      "calculator",
      {"name": "custom_tool", "tool_type": "custom"},
    ]

    tools, config_dict = tool_factory.create_tools_from_config(
      tool_configs=tool_configs,
      doc_tree=[{"id": "d1"}],
      brain_tree=[{"id": "b1"}],
      brain_ids=["brain-1"],
      default_agent_params={"temperature": 0.2, "max_tokens": 512},
    )

    assert len(tools) >= 2
    assert "search" in config_dict
    assert "calculator" in config_dict
    assert "custom_tool" in config_dict
    mock_create_search.assert_called_once()

  def test_create_tools_from_config_empty_returns_empty(self, tool_factory):
    tools, config_dict = tool_factory.create_tools_from_config([])
    assert tools == []
    assert config_dict == {}

  def test_create_tools_from_config_binds_assigned_workspace_file_tool(self, tool_factory):
    tools, _ = tool_factory.create_tools_from_config(
      [{"name": "save_file_to_workspace", "tool_type": "native"}],
      default_agent_params={
        "platform_api_url": "https://platform.example.com",
        "platform_api_token": "internal-secret",
        "user_id": "user-1",
      },
    )

    assert len(tools) == 1
    assert tools[0].__name__ == "save_file_to_workspace"

  @patch("src.smart_rag.agents.factories.base_factory.SearchToolkit")
  @patch("src.smart_rag.agents.factories.base_factory.in_memory_construct_json")
  def test_create_in_memory_tools_success(
      self, mock_in_memory_construct, mock_toolkit_cls, tool_factory
  ):
    mock_in_memory_construct.return_value = (
      {"schema": True},
      {"attr": "map"},
      [{"id": "doc1"}],
    )
    mock_toolkit = MagicMock()
    mock_toolkit.generate_function.return_value = (
      MagicMock(),
      {"function": {"name": "in_memory"}},
    )
    mock_toolkit_cls.return_value = mock_toolkit

    tools, toolkit = tool_factory.create_in_memory_tools(
      doc_tree=[{"name": "Doc", "id": "d1"}],
      brain_ids=["brain-1"],
      top_k=3,
      vectorstore_name="vs",
      in_memory_tool_description="extract fields",
    )

    assert len(tools) == 1
    assert toolkit is mock_toolkit
    mock_in_memory_construct.assert_called_once()
    mock_toolkit.set_in_memory_documents.assert_called_once()

  @patch("src.smart_rag.agents.factories.base_factory.in_memory_construct_json")
  def test_create_in_memory_tools_no_schema_returns_empty(
      self, mock_in_memory_construct, tool_factory
  ):
    mock_in_memory_construct.return_value = (None, None, None)

    tools, toolkit = tool_factory.create_in_memory_tools(
      doc_tree=[{"name": "Doc"}],
      brain_ids=["brain-1"],
      top_k=3,
      vectorstore_name="vs",
      in_memory_tool_description="desc",
    )

    assert tools == []
    assert toolkit is None

  @patch("src.smart_rag.agents.factories.base_factory.in_memory_construct_json")
  def test_create_in_memory_tools_handles_exception(
      self, mock_in_memory_construct, tool_factory
  ):
    mock_in_memory_construct.side_effect = RuntimeError("boom")

    tools, toolkit = tool_factory.create_in_memory_tools(
      doc_tree=[{"name": "Doc"}],
      brain_ids=["brain-1"],
      top_k=3,
      vectorstore_name="vs",
      in_memory_tool_description="desc",
    )

    assert tools == []
    assert toolkit is None
