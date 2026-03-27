"""Tool Configuration Module

Provides flexible tool configuration system that accepts lists of dictionaries
with customizable parameters for tools and agent settings.
"""

from typing import Dict, List, Any, Optional, Union
from dataclasses import dataclass, field
import copy

from src.logger.logging import get_logger

logger = get_logger("api.routers.agentic_rag.ToolConfiguration")


@dataclass
class AgentParameters:
    """Agent-specific parameters like temperature and max_tokens."""
    temperature: float = 0.7
    max_tokens: int = 1024

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'AgentParameters':
        """Create AgentParameters from dictionary with defaults."""
        return cls(
            temperature=data.get('temperature', 0.7),
            max_tokens=data.get('max_tokens', 1024)
        )


@dataclass
class ToolConfig:
    """Configuration for a single tool."""
    name: str
    description: str = ""
    prompt: Optional[str] = None
    top_k: int = 4
    tool_type: str = "search"
    enabled: bool = True
    agent_params: Optional[AgentParameters] = None
    custom_params: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Dict[str, Any], default_description: str = "") -> 'ToolConfig':
        """Create ToolConfig from dictionary with intelligent defaults."""
        # Handle name - required field
        if 'name' not in data:
            raise ValueError("Tool configuration must include 'name' field")

        name = data['name']

        # Handle description with defaults
        description = data.get('description')
        if not description:
            description = default_description or f"Tool for {name}"

        # Handle prompt - append to description if provided
        prompt = data.get('prompt')
        if prompt:
            description = f"{description}\n{prompt}"

        # Handle agent parameters
        agent_params = None
        if 'agent_params' in data:
            agent_params = AgentParameters.from_dict(data['agent_params'])
        elif any(key in data for key in ['temperature', 'max_tokens']):
            # Extract agent params from top level
            agent_data = {
                'temperature': data.get('temperature'),
                'max_tokens': data.get('max_tokens')
            }
            agent_params = AgentParameters.from_dict(agent_data)

        # Extract other parameters
        config = cls(
            name=name,
            description=description,
            prompt=prompt,
            top_k=data.get('top_k', 4),
            tool_type=data.get('tool_type', 'search'),
            enabled=data.get('enabled', True),
            agent_params=agent_params,
            custom_params=data.get('custom_params', {})
        )

        # Store any extra parameters in custom_params
        excluded_keys = {
            'name', 'description', 'prompt', 'top_k', 'tool_type', 'enabled',
            'agent_params', 'custom_params', 'temperature', 'max_tokens'
        }
        for key, value in data.items():
            if key not in excluded_keys:
                config.custom_params[key] = value

        return config


class ToolConfigurationManager:
    """Manager for handling flexible tool configurations."""

    def __init__(self):
        """Initialize the tool configuration manager."""
        self.default_descriptions = {
            'search': "Search through documents and knowledge base",
            'web_search': "Search the web for information",
            'calculator': "Perform mathematical calculations",
            'memory': "Access and manage memory storage",
            'agent': "Delegate tasks to specialized agents"
        }

        self.default_agent_params = AgentParameters()

    def process_tool_configs(self,
                           tools: Union[List[Dict[str, Any]], List[str]],
                           default_description: Optional[str] = None,
                           default_agent_params: Optional[Dict[str, Any]] = None) -> List[ToolConfig]:
        """
        Process a list of tool configurations with flexible input formats.

        Args:
            tools: List of tool configurations (dicts) or tool names (strings)
            default_description: Default description to use if not provided
            default_agent_params: Default agent parameters to use if not provided

        Returns:
            List of ToolConfig objects with applied defaults

        Examples:
            # Simple string list
            tools = ["search", "calculator"]

            # Mixed format
            tools = [
                "search",
                {
                    "name": "web_search",
                    "prompt": "Search with high precision",
                    "top_k": 10,
                    "temperature": 0.5
                }
            ]

            # Full configuration
            tools = [
                {
                    "name": "custom_search",
                    "description": "Custom search tool",
                    "prompt": "Additional search instructions",
                    "top_k": 8,
                    "agent_params": {
                        "temperature": 0.3,
                        "max_tokens": 2048
                    }
                }
            ]
        """
        if not tools:
            return []

        processed_configs = []

        # Set up default agent parameters
        if default_agent_params:
            self.default_agent_params = AgentParameters.from_dict(default_agent_params)

        for tool_input in tools:
            try:
                if isinstance(tool_input, str):
                    # Handle simple string input
                    config = self._create_config_from_string(tool_input, default_description)
                elif isinstance(tool_input, dict):
                    # Handle dictionary input
                    config = self._create_config_from_dict(tool_input, default_description)
                else:
                    logger.warning(f"Unsupported tool input type: {type(tool_input)}")
                    continue

                processed_configs.append(config)

            except Exception as e:
                logger.error(f"Error processing tool config {tool_input}: {e}")
                continue

        return processed_configs

    def _create_config_from_string(self, tool_name: str, default_description: Optional[str] = None) -> ToolConfig:
        """Create ToolConfig from string name."""
        # Normalize tool name to lowercase for case-insensitive matching
        tool_name_lower = tool_name.lower()

        # Get default description based on tool type (case-insensitive)
        description = default_description or self.default_descriptions.get(tool_name_lower, f"Tool for {tool_name}")

        return ToolConfig(
            name=tool_name,
            description=description,
            tool_type=tool_name_lower if tool_name_lower in self.default_descriptions else 'custom',
            agent_params=copy.deepcopy(self.default_agent_params)
        )

    def _create_config_from_dict(self, tool_dict: Dict[str, Any], default_description: Optional[str] = None) -> ToolConfig:
        """Create ToolConfig from dictionary."""
        # Use tool-specific default if no description provided
        tool_name = tool_dict.get('name', 'unknown')
        tool_name_lower = tool_name.lower()
        if not default_description and not tool_dict.get('description'):
            default_description = self.default_descriptions.get(tool_name_lower, f"Tool for {tool_name}")

        # Normalize tool_type to lowercase if provided
        tool_dict_normalized = tool_dict.copy()
        if 'tool_type' in tool_dict_normalized:
            tool_dict_normalized['tool_type'] = tool_dict_normalized['tool_type'].lower()

        config = ToolConfig.from_dict(tool_dict_normalized, default_description or "")

        # Apply default agent params if not specified
        if not config.agent_params:
            config.agent_params = copy.deepcopy(self.default_agent_params)

        return config

    def get_tool_by_name(self, configs: List[ToolConfig], name: str) -> Optional[ToolConfig]:
        """Find a tool configuration by name."""
        for config in configs:
            if config.name == name:
                return config
        return None

    def filter_enabled_tools(self, configs: List[ToolConfig]) -> List[ToolConfig]:
        """Filter only enabled tool configurations."""
        return [config for config in configs if config.enabled]

    def group_by_type(self, configs: List[ToolConfig]) -> Dict[str, List[ToolConfig]]:
        """Group tool configurations by type."""
        grouped = {}
        for config in configs:
            if config.tool_type not in grouped:
                grouped[config.tool_type] = []
            grouped[config.tool_type].append(config)
        return grouped

    def apply_global_agent_params(self, configs: List[ToolConfig], agent_params: Dict[str, Any]) -> List[ToolConfig]:
        """Apply global agent parameters to all configurations."""
        global_params = AgentParameters.from_dict(agent_params)

        updated_configs = []
        for config in configs:
            updated_config = copy.deepcopy(config)
            if not updated_config.agent_params:
                updated_config.agent_params = global_params
            else:
                # Merge with existing params, global takes precedence
                updated_config.agent_params = AgentParameters.from_dict({
                    **updated_config.agent_params.__dict__,
                    **agent_params
                })
            updated_configs.append(updated_config)

        return updated_configs

    def to_dict_list(self, configs: List[ToolConfig]) -> List[Dict[str, Any]]:
        """Convert ToolConfig objects back to dictionary list."""
        result = []

        for config in configs:
            tool_dict = {
                'name': config.name,
                'description': config.description,
                'top_k': config.top_k,
                'tool_type': config.tool_type,
                'enabled': config.enabled
            }

            if config.prompt:
                tool_dict['prompt'] = config.prompt

            if config.agent_params:
                tool_dict['agent_params'] = {
                    'temperature': config.agent_params.temperature,
                    'max_tokens': config.agent_params.max_tokens
                }

            if config.custom_params:
                tool_dict.update(config.custom_params)

            result.append(tool_dict)

        return result


# Convenience functions for backward compatibility and ease of use
def configure_tools(tools: Union[List[Dict[str, Any]], List[str]],
                   default_description: Optional[str] = None,
                   default_agent_params: Optional[Dict[str, Any]] = None) -> List[ToolConfig]:
    """
    Convenience function to configure tools with defaults.

    Args:
        tools: List of tool configurations or names
        default_description: Default description for tools
        default_agent_params: Default agent parameters

    Returns:
        List of configured ToolConfig objects
    """
    manager = ToolConfigurationManager()
    return manager.process_tool_configs(tools, default_description, default_agent_params)


def extract_agent_params(configs: List[ToolConfig]) -> Dict[str, AgentParameters]:
    """Extract agent parameters from tool configurations."""
    agent_params = {}
    for config in configs:
        if config.agent_params:
            agent_params[config.name] = config.agent_params
    return agent_params


def get_tools_by_type(configs: List[ToolConfig], tool_type: str) -> List[ToolConfig]:
    """Get all tools of a specific type."""
    return [config for config in configs if config.tool_type == tool_type]