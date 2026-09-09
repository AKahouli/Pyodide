from typing import Dict, Any

def create_enhanced_prompt(tool_provider, agent_repository, agent_config: Dict[str, Any], tools, tools_for_config=None) -> str:
    """Create enhanced prompt with tool descriptions and context.

    Builds a comprehensive prompt by combining the base agent prompt with
    tool descriptions, citation requirements, conversation context, and
    source reference requirements based on agent type and team composition.

    Args:
        agent_config (Dict[str, Any]): Agent configuration containing base prompt.
        tools: List of tools available to the agent (strings or configs).
        tools_for_config: Optional detailed tool configurations with custom descriptions and settings.

    Returns:
        str: Enhanced prompt with all necessary context and instructions.
    """
    # Use tools_for_config for descriptions if provided, otherwise use tools
    tools_with_configs = tools_for_config if tools_for_config is not None else tools

    base_prompt = (agent_config['prompt'] +
                   tool_provider.get_tools_description(tools_with_configs) )
    # Add source reference requirements for non-HTML agents when search agents exist in team
    is_html_agent = agent_config.get('html', False)

    return base_prompt
