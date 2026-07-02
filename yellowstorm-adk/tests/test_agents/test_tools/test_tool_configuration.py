"""Unit tests for ToolConfigurationManager."""

import pytest

from src.smart_rag.agents.tools.tool_configuration import (
  AgentParameters,
  ToolConfig,
  ToolConfigurationManager,
  configure_tools,
  extract_agent_params,
  get_tools_by_type,
)


class TestToolConfigurationManager:
  def test_process_tool_configs_from_strings(self):
    manager = ToolConfigurationManager()
    configs = manager.process_tool_configs(["search", "calculator"])

    assert len(configs) == 2
    assert configs[0].tool_type == "search"
    assert configs[1].tool_type == "calculator"
    assert configs[0].agent_params is not None

  def test_process_tool_configs_from_dicts(self):
    manager = ToolConfigurationManager()
    configs = manager.process_tool_configs(
      [
        {
          "name": "web_search",
          "prompt": "Be precise",
          "top_k": 10,
          "temperature": 0.4,
          "max_tokens": 2048,
        }
      ]
    )

    assert configs[0].name == "web_search"
    assert configs[0].top_k == 10
    assert "Be precise" in configs[0].description
    assert configs[0].agent_params.temperature == 0.4
    assert configs[0].agent_params.max_tokens == 2048

  def test_process_tool_configs_skips_invalid_entries(self):
    manager = ToolConfigurationManager()
    configs = manager.process_tool_configs(["search", 123, {"name": "calc"}])

    assert len(configs) == 2
    assert configs[1].name == "calc"

  def test_tool_config_from_dict_requires_name(self):
    with pytest.raises(ValueError, match="name"):
      ToolConfig.from_dict({})

  def test_get_tool_by_name_and_filter_enabled(self):
    manager = ToolConfigurationManager()
    configs = manager.process_tool_configs(
      ["search", {"name": "disabled_tool", "enabled": False, "tool_type": "custom"}]
    )

    found = manager.get_tool_by_name(configs, "search")
    enabled = manager.filter_enabled_tools(configs)

    assert found is not None
    assert found.name == "search"
    assert len(enabled) == 1

  def test_group_by_type_and_apply_global_agent_params(self):
    manager = ToolConfigurationManager()
    configs = manager.process_tool_configs(["search", "calculator"])
    grouped = manager.group_by_type(configs)
    updated = manager.apply_global_agent_params(
      configs, {"temperature": 0.1, "max_tokens": 256}
    )

    assert "search" in grouped
    assert "calculator" in grouped
    assert all(cfg.agent_params.temperature == 0.1 for cfg in updated)
    assert all(cfg.agent_params.max_tokens == 256 for cfg in updated)

  def test_to_dict_list_round_trip_fields(self):
    manager = ToolConfigurationManager()
    configs = manager.process_tool_configs(
      [{"name": "search", "custom_params": {"foo": "bar"}}]
    )
    as_dicts = manager.to_dict_list(configs)

    assert as_dicts[0]["name"] == "search"
    assert as_dicts[0]["foo"] == "bar"
    assert "agent_params" in as_dicts[0]

  def test_configure_tools_convenience_function(self):
    configs = configure_tools(
      ["memory", "agent"],
      default_agent_params={"temperature": 0.9},
    )
    assert len(configs) == 2
    assert configs[0].agent_params.temperature == 0.9

  def test_extract_agent_params_and_get_tools_by_type(self):
    configs = configure_tools(["search", "web_search", "calculator"])
    params = extract_agent_params(configs)
    search_tools = get_tools_by_type(configs, "search")

    assert "search" in params
    assert isinstance(params["search"], AgentParameters)
    assert len(search_tools) == 1
