"""Tool utility functions.

This module provides utility functions for working with tools in different formats,
avoiding circular imports between tool modules and factories.
"""

from typing import List, Any


def normalize_tools(tools: List[Any]) -> List[Any]:
    """Normalize tool formats to ensure case-insensitive tool names.

    Converts tool names to lowercase in both string and dictionary formats.
    This should be called at entry points where tools are first received.

    Args:
        tools: List of tools in either string or dict format

    Returns:
        List[Any]: Normalized tools with lowercase names
    """
    normalized = []

    for tool in tools:
        if isinstance(tool, str):
            # Normalize string tool names to lowercase
            normalized.append(tool.lower())
        elif callable(tool):
            # Python function: keep as is (name is used directly)
            normalized.append(tool)
        elif isinstance(tool, dict):
            # Normalize dictionary tool names to lowercase
            normalized_tool = tool.copy()
            if 'name' in normalized_tool:
                normalized_tool['name'] = normalized_tool['name'].lower()
            normalized.append(normalized_tool)
        else:
            # Unknown format, keep as is
            normalized.append(tool)

    return normalized


def extract_tool_names(tools: List[Any]) -> List[str]:
    """Extract tool names from flexible tool format.

    Handles both string format and dictionary format tools, extracting
    just the names for display purposes. All tool names are returned in
    lowercase for case-insensitive comparison.

    Args:
        tools: List of tools in either string or dict format

    Returns:
        List[str]: List of tool names in lowercase
    """
    tool_names = []

    for tool in tools:
        if isinstance(tool, str):
            # Simple string format: "search", "calculator" - normalize to lowercase
            tool_names.append(tool.lower())
        elif callable(tool):
            # Python function format: use function name
            tool_names.append(tool.__name__.lower())
        elif isinstance(tool, dict) and 'name' in tool:
            # Dictionary format: {"name": "search_web", "description": "...", ...} - normalize to lowercase
            tool_names.append(tool['name'].lower())
        else:
            # Unknown format, convert to string as fallback - normalize to lowercase
            tool_names.append(str(tool).lower())

    return tool_names


def extract_tool_names_and_descriptions(tools: List[Any]) -> str:
    """Extract tool names and descriptions from flexible tool format.

    Handles both string format and dictionary format tools, extracting
    names and descriptions formatted as a string.

    Args:
        tools: List of tools in either string or dict format

    Returns:
        str: Formatted string with "toolname: its description\\n" for each tool
    """
    result = []

    for tool in tools:
        if isinstance(tool, str):
            # Simple string format: just the name, no description available
            result.append(f"{tool}: No description available")
        elif callable(tool):
            # Python function format: use function name
            result.append(f"{tool.__name__}: No description available")
        elif isinstance(tool, dict) and 'name' in tool:
            # Dictionary format: {"name": "search_web", "description": "...", ...}
            name = tool['name']
            description = tool.get('description', 'No description available')
            result.append(f"{name}: {description}")
        else:
            # Unknown format, convert to string as fallback
            result.append(f"{str(tool)}: No description available")

    return '\n'.join(result)