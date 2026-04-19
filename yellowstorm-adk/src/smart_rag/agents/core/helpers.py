"""Helper functions for agent name sanitization and prompt preparation.

This module provides utility functions for managing agent configurations,
including name sanitization, prompt enhancement, and preparation for execution.
It handles agent data validation, tool assignment, and brain document integration.

Classes:
    AgentHelper: Main utility class for agent-related operations.
"""

import json
from typing import Optional, List, Any, Dict
from src.config.settings import get_settings
import re2 as re

from src.schema.chatbot_schema import RunAgentTeamRequest
from src.logger.logging import get_logger
from src.smart_rag.agents.core.document_helpers import DocumentHelpers
from src.smart_rag.tools.utilities.tool_utils import extract_tool_names
from src.smart_rag.engines.multi_agent.config import FUNCTION_NAME_PATTERN, DEFAULT_AGENT_NAME
from src.smart_rag.tools import build_tree

logger = get_logger("api.routers.agentic_rag.AgentHelper")
settings = get_settings()

CHART_TOOL_GUIDANCE = """

<chart_tool_guidance>
You can call the `render_chart` tool when the answer becomes analytical and a visual will help the user.
Only call it with concrete numeric data.
Never send an empty `data` array.
For non-scatter charts, always include at least one `series` entry.
Place charts between explanatory paragraphs rather than at the very end.
</chart_tool_guidance>
"""

class AgentHelper:
    """Utility class for sanitizing agent names and preparing prompts and agent data.
    
    This class provides static methods for various agent management tasks including
    name normalization, prompt enhancement, configuration validation, and data
    preparation for agent execution.
    
    Methods:
        sanitize_function_name: Sanitize agent names for function naming.
        normalize_agent_name: Normalize agent names for comparison.
        get_document_tree_info: Format document tree info for prompts.
        pre_agent_run_config: Prepare agents before execution.
        _prepare_agent_data: Prepare individual agent data with brain docs and tools.
        _populate_brain_data: Populate brain documents/relations if agent uses search tool.
        _remove_search_if_empty: Remove search tool if no brain data is available.
        _create_enhanced_manager_prompt: Create enhanced manager prompt with agent list.
    """

    @staticmethod
    def sanitize_function_name(name: str) -> str:
        """Sanitize agent name to create valid function names for Azure OpenAI.

        Replaces invalid characters with underscores, ensures it doesn't start with a digit,
        removes LLM-generated suffixes like <|channel|>commentary, and defaults to 'agent'
        if the name is empty after sanitization.

        Args:
            name (str): The original agent name to sanitize.

        Returns:
            str: Sanitized function name safe for use as Azure OpenAI function identifier.
        """
        # Remove LLM-generated suffixes like <|channel|>commentary, <|constrain|>, <|im_start|>, etc.
        sanitized = re.sub(r'<\|[^|]*\|>.*', '', name)

        # Apply standard pattern replacement
        sanitized = re.sub(FUNCTION_NAME_PATTERN, '_', sanitized.lower())
        sanitized = re.sub(r'_+', '_', sanitized)

        # Remove leading/trailing underscores
        sanitized = sanitized.strip('_')

        if sanitized and sanitized[0].isdigit():
            sanitized = f"_{sanitized}"

        return sanitized or DEFAULT_AGENT_NAME

    @staticmethod
    def normalize_agent_name(name: str) -> str:
        """Normalize agent name for comparison.

        Converts to lowercase and replaces spaces with underscores while preserving
        other characters for flexible agent name matching across the system.

        Args:
            name (str): The original agent name to normalize.

        Returns:
            str: Normalized agent name suitable for comparison operations.

        Raises:
            TypeError: If name is not a string.
        """
        if not isinstance(name, str):
            raise TypeError(f"Expected string, got {type(name).__name__}")

        if not name:
            return name

        # Convert to lowercase and replace spaces with underscores
        normalized = name.replace(" ", "_").lower()

        return normalized

    @staticmethod
    def get_document_tree_info(doc_tree: Optional[List], brain_tree: Optional[List]) -> str:
        """Get formatted document tree information for inclusion in prompts.
        
        Formats document and brain tree structures into a string representation
        suitable for inclusion in agent prompts, providing context about available
        knowledge sources.
        
        Args:
            doc_tree (Optional[List]): The document tree structure containing
                hierarchical organization of documents.
            brain_tree (Optional[List]): The brain tree structure containing
                knowledge relationships and connections.
        
        Returns:
            str: Formatted string with document and brain tree information,
                empty string if no doc_tree provided.
        """
        if not doc_tree:
            return ""

        tree_info = f"\n\n< documents_tree >\n{json.dumps(doc_tree, indent=4)}\n</ documents_tree >"
        if brain_tree:
            tree_info += f"\n\n< brain_tree >\n{json.dumps(brain_tree, indent=4)}\n</ brain_tree >"
        return tree_info

    @staticmethod
    def get_manager_prompt_from_agents(agents: List, fallback_prompt: str) -> str:
        """Extract manager prompt from agents list if a manager agent exists.

        Searches for an agent with agent_type="manager" in the agents list and returns
        its prompt. If no manager agent is found, returns the fallback prompt.

        Args:
            agents (List): List of agent configurations.
            fallback_prompt (str): Fallback prompt to use if no manager agent exists.

        Returns:
            str: Manager prompt from manager agent or fallback prompt.
        """
        from src.smart_rag.agents.core.document_helpers import DocumentHelpers

        for agent in agents:
            agent_dict = DocumentHelpers.agent_to_dict(agent)
            if agent_dict.get('agent_type') == 'manager':
                logger.info(f"Found manager agent: {agent_dict.get('name')}. Using its prompt.")
                prompt= agent_dict.get('prompt', "")
                return prompt

        logger.info("No manager agent found in agents list. Using fallback prompt from extract_prompts.")
        return fallback_prompt

    @staticmethod
    def get_html_prompt_from_agents(agents: List, fallback_prompt: str) -> str:
        """Extract visualizer prompt from agents list if a visualizer agent exists.
        Searches for an agent with agent_type="visualizer" in the agents list and returns
        its prompt. If no visualizer agent is found, returns the fallback prompt.
        Args:
            agents (List): List of agent configurations.
            fallback_prompt (str): Fallback prompt to use if no visualizer agent exists.
        Returns:
            str: Visualizer prompt from visualizer agent or fallback prompt.
        """
        from src.smart_rag.agents.core.document_helpers import DocumentHelpers
        for agent in agents:
            agent_dict = DocumentHelpers.agent_to_dict(agent)
            if agent_dict.get('agent_type') == 'visualizer':
                logger.info(
                    f"Found visualizer agent: {agent_dict.get('name')}. Using its prompt."
                )
                return agent_dict.get('prompt', fallback_prompt)

        if settings.DEFAULT_HTML_AGENT_ENABLED:
            logger.info(
                "Default HTML agent is enabled and no visualizer agent was found. Using fallback prompt."
            )
            return fallback_prompt

        logger.info(
            "No visualizer agent found and DEFAULT_HTML_AGENT_ENABLED is disabled. Using fallback prompt from extract_prompts."
        )
        return fallback_prompt


    @staticmethod
    def get_temperature_from_agents(agents: List, fallback_temperature: float = 0.1) -> float:
        """Extract temperature from agents list if a manager agent exists.

        Searches for an agent with agent_type="manager" in the agents list and returns
        its temperature from agents_params. If no manager agent is found or temperature
        is not specified, returns the fallback temperature.

        Args:
            agents (List): List of agent configurations.
            fallback_temperature (float): Fallback temperature to use if no manager agent
                exists or temperature is not specified. Defaults to 0.1.

        Returns:
            float: Temperature from manager agent's agents_params or fallback temperature.
        """
        from src.smart_rag.agents.core.document_helpers import DocumentHelpers

        for agent in agents:
            agent_dict = DocumentHelpers.agent_to_dict(agent)
            if agent_dict.get('agent_type') == 'manager':
                agent_params = agent_dict.get('agent_params', {})
                if isinstance(agent_params, dict) and 'temperature' in agent_params:
                    temperature = agent_params.get('temperature')
                    logger.info(f"Found manager agent: {agent_dict.get('name')}. Using temperature: {temperature}")
                    return temperature
                else:
                    logger.info(f"Found manager agent: {agent_dict.get('name')} but no temperature in agents_params. Using fallback.")
                    return fallback_temperature

        logger.info("No manager agent found in agents list. Using fallback temperature.")
        return fallback_temperature

    @staticmethod
    def get_manager_memory_from_agents(agents: List, fallback_save_memory: bool = False) -> bool:
        """Extract save_memory attribute from agents list if a manager agent exists.

        Searches for an agent with agent_type="manager" in the agents list and returns
        its save_memory attribute. If no manager agent is found or save_memory is not
        specified, returns the fallback value.

        Args:
            agents (List): List of agent configurations.
            fallback_save_memory (bool): Fallback value to use if no manager agent
                exists or save_memory is not specified. Defaults to True.

        Returns:
            bool: save_memory value from manager agent or fallback value.
        """
        from src.smart_rag.agents.core.document_helpers import DocumentHelpers

        for agent in agents:
            agent_dict = DocumentHelpers.agent_to_dict(agent)
            if agent_dict.get('agent_type') == 'manager':
                save_memory = agent_dict.get('save_memory')
                if save_memory is not None:
                    logger.info(f"Found manager agent: {agent_dict.get('name')}. Using save_memory: {save_memory}")
                    return save_memory
                else:
                    logger.info(f"Found manager agent: {agent_dict.get('name')} but no save_memory attribute. Using fallback.")
                    return fallback_save_memory

        logger.info("No manager agent found in agents list. Using fallback save_memory.")
        return fallback_save_memory

    @staticmethod
    def get_manager_tools_from_agents(agents: List) -> List[str]:
        """Extract tools list from agents list if a manager agent exists.

        Searches for an agent with agent_type="manager" in the agents list and returns
        its tools list. If no manager agent is found or tools are not specified,
        returns an empty list.

        Args:
            agents (List): List of agent configurations.

        Returns:
            List[str]: List of tool names from manager agent or empty list.
        """
        from src.smart_rag.agents.core.document_helpers import DocumentHelpers

        for agent in agents:
            agent_dict = DocumentHelpers.agent_to_dict(agent)
            agent_type = agent_dict.get('agent_type')
            agent_name = agent_dict.get('name', 'unnamed')

            logger.debug(f"[MANAGER TOOLS] Checking agent '{agent_name}' with type '{agent_type}'")

            if agent_type == 'manager':
                tools = agent_dict.get('tools', [])
                if tools:
                    # Extract tool names from tools list
                    tool_names = []
                    for tool in tools:
                        if isinstance(tool, dict):
                            tool_name = tool.get('name')
                            if tool_name:
                                tool_names.append(tool_name)
                                logger.debug(f"[MANAGER TOOLS] Extracted tool name from dict: {tool_name}")
                        elif isinstance(tool, str):
                            tool_names.append(tool)
                            logger.debug(f"[MANAGER TOOLS] Extracted tool name from string: {tool}")

                    return tool_names
                else:
                    return []

        return []

    @staticmethod
    def _build_file_context_prompt(attached_files=None, attached_images=None, previous_attached_files=None) -> str:
        """Build a prompt section describing attached files and images for agent context.

        Args:
            attached_files: Documents attached in this turn
            attached_images: Images attached in this turn (list of {"filename": "..."})
            previous_attached_files: Already-indexed files from previous turns

        Returns:
            Prompt string to append, or empty string if no files.
        """
        import json

        def _build_file_tree(files):
            """Build document tree nodes."""
            tree = []
            for f in files:
                node = {
                    "nom": f.get('filename', f.get('name', 'Unknown')),
                    "in_memory": f.get('in_memory', False),
                    "children": []
                }

                custom_type = f.get('customType')
                if custom_type is not None:
                    node["type"] = custom_type

                predicted_category = f.get('predicted_category', '')
                if predicted_category:
                    node["parent_folder"] = predicted_category

                if 'language' in f:
                    node["language"] = f['language']

                sheet_name = f.get('sheetName')
                if sheet_name and sheet_name.strip():
                    node["excelSheet"] = sheet_name

                created_at = f.get('createdAt')
                if created_at:
                    node["createdAt"] = created_at

                tree.append(node)
            return tree

        parts = []

        if attached_files:
            file_tree = _build_file_tree(attached_files)
            parts.append("<attached_files>")
            parts.append("The user attached the following files:")
            parts.append(json.dumps(file_tree, ensure_ascii=False))
            parts.append("")
            parts.append("Instructions:")
            parts.append("- The user message may reference the attached files.")
            parts.append("- Use the file contents when relevant.")
            parts.append("- If the user asks about a specific file, prioritize that file.")
            parts.append("</attached_files>")

        if attached_images:
            image_names = [img.get("filename", "Unknown") for img in attached_images]
            parts.append("<attached_images>")
            parts.append("The user attached the following images:")
            parts.append(json.dumps(image_names, ensure_ascii=False))
            parts.append("")
            parts.append("Instructions:")
            parts.append("- The images are included in the conversation context.")
            parts.append("- When delegating tasks related to these images, you MUST set delegate_images=True.")
            parts.append("</attached_images>")

        if previous_attached_files:
            file_tree = _build_file_tree(previous_attached_files)
            parts.append("<previous_attached_files>")
            parts.append("The following files were attached in previous turns :")
            parts.append(json.dumps(file_tree, ensure_ascii=False))
            parts.append("")
            parts.append("Instructions:")
            parts.append("- These files are available for search and reference.")
            parts.append("- The user may ask follow-up questions about these files.")
            parts.append("</previous_attached_files>")

        return "\n".join(parts)

    @staticmethod
    def _create_enhanced_manager_prompt(manager_prompt: str, agents: List, config=None) -> str:
        """Create enhanced manager prompt with agent list.

        Combines the base manager prompt with a formatted list of available agents
        and delegation instructions, enabling the manager to effectively coordinate
        team operations.

        Args:
            manager_prompt (str): The base prompt for the manager agent.
            agents (List): List of agent configurations with name and description.
            config: Optional AgentTeamConfig with attached_files context.

        Returns:
            str: Enhanced prompt including available agents and delegation instructions.
        """
        from src.smart_rag.agents.core.document_helpers import DocumentHelpers

        agents_data = []
        for agent in agents:
            agent_dict = DocumentHelpers.agent_to_dict(agent)
            tools_list = []
            for tool in (agent_dict.get('tools', []) or []):
                if isinstance(tool, dict):
                    tools_list.append({"name": tool.get("name", ""), "description": tool.get("description", "")})
                elif isinstance(tool, str):
                    tools_list.append({"name": tool, "description": ""})
            agents_data.append({
                "name": agent_dict.get('name', 'unnamed'),
                "description": agent_dict.get('description', ''),
                "tools": tools_list
            })

        agents_json = json.dumps(agents_data, indent=2)

        # Build file context if attached files or images are present
        file_context = ""
        if config:
            file_context = AgentHelper._build_file_context_prompt(
                getattr(config, 'attached_files', None),
                getattr(config, 'attached_images', None),
                getattr(config, 'previous_attached_files', None),
            )

        prompt = f"""{manager_prompt}

You have access to delegate functions for each agent. Use the appropriate delegate_to_[agent_name] function to call the agent that can best handle the user's request. Do not just mention agents - actually call their delegate functions with the user's task.

{CHART_TOOL_GUIDANCE}

<available_agents>
{agents_json}
</available_agents>"""

        if file_context:
            prompt = f"{prompt}\n\n{file_context}"

        return prompt

    @staticmethod
    def pre_agent_run_config(report_writer_prompt: str,html_agent_prompt:str, agents, fallback_chatbot_name: dict = None,response_format_for_html_agents:str=""):
        """Prepare agents before execution.

        Performs pre-execution setup for agents including adding a report writer agent,
        applying fallback chatbot configurations, and enhancing agent descriptions with
        available tools information.

        Args:
            report_writer_prompt (str): Prompt template for the report writer agent.
            html_agent_prompt (str): Prompt template for the HTML/visualizer agent.
            agents (list): List of agent configurations to prepare and modify in-place.
            fallback_chatbot_name (dict, optional): Fallback chatbot name to apply
                to agents that don't have a chatbot_name specified.

        Returns:
            None: Modifies the agents list in-place.
        """

        #check if html agent already exists in team
        html_added=False
        if any(agent.get('agent_type') == "visualizer" for agent in agents):
            logger.debug("HTML-capable agent already exists in the agents list. Skipping addition.")
            html_added=True

        if settings.DEFAULT_HTML_AGENT_ENABLED and not html_added:
            default_prompt = html_agent_prompt
            if response_format_for_html_agents:
                default_prompt = default_prompt + f"\n\n {response_format_for_html_agents}\n"
            html_agent = {
                "name": "Visualizer Agent",
                "description": "Generates visualisations using html, css, and javascript to create charts, graphs, and other visual elements to effectively communicate data insights",
                "prompt": default_prompt,
                "tools": [],
            }
            agents.append(html_agent)

        # Add critical output requirement for all visualizer agents
        for agent in agents:
            if agent.get('agent_type') == "visualizer":
                agent['prompt'] = agent.get('prompt', "") + (
                    "\n\n**Critical Output Requirement:**\n"
                    "\u26a0\ufe0f **Your response must ALWAYS be a complete, standalone HTML file that can be executed at once.**\n"
                    "\u26a0\ufe0f **NEVER provide only partial code, fragments, or just the modified sections.**"
                )

        # Apply chatbot_name fallback for all agents that don't have it specified
        if fallback_chatbot_name:
            for agent in agents:
                if not agent.get('chatbot_name'):
                    agent['chatbot_name'] = fallback_chatbot_name
                    logger.debug \
                        (f"Applied chatbot_name fallback for agent '{agent.get('name', 'unnamed')}': {fallback_chatbot_name}")


    @staticmethod
    def _prepare_agent_data(agent_dict, user_request, team) -> dict:
        """Prepare agent data with brain documents/relations and tool adjustments.

        Processes agent configuration to ensure proper tool assignment and brain data
        population, especially for agents with search capabilities.

        Args:
            agent_dict: Agent configuration object or dictionary to prepare.
            user_request: User request containing brain documents and relations.
            team: Team configuration with default document and brain trees.

        Returns:
            dict: Prepared agent data with populated brain documents and adjusted tools.
        """
        agent_data = agent_dict
        if not isinstance(agent_data, dict):
            agent_data = agent_data.__dict__
        tools = agent_data.get('tools', []) or []

        # Extract tool names from flexible format
        tool_names = extract_tool_names(tools)

        if 'search' in tool_names:
            doc_helper= DocumentHelpers()
            agent_data = doc_helper._populate_brain_data(agent_data, user_request, team)
            agent_data, tools = AgentHelper._remove_search_if_empty(agent_data, tools)

        agent_data['tools'] = tools
        return agent_data

    @staticmethod
    def _remove_search_if_empty(agent_data, tools):
        """Remove search tool if brain_documents and brain_relations are empty.
        
        Validates that agents with search tools have access to brain data, removing
        the search tool and updating the prompt if no data is available.
        
        Args:
            agent_data: Agent configuration dictionary to validate and potentially modify.
            tools: List of tools assigned to the agent.
            
        Returns:
            tuple: (Updated agent_data, Updated tools list) with search tool removed
                if no brain data is available.
        """
        brain_docs_empty = not agent_data.get('brain_documents')
        brain_relations_empty = not agent_data.get('brain_relations') or agent_data.get('brain_relations') == {
            'nodes': [], 'relationships': []}

        if brain_docs_empty and brain_relations_empty:
            # Remove search tool handling both string and dict formats
            filtered_tools = []
            for tool in tools:
                if isinstance(tool, str):
                    if tool.lower() != 'search':
                        filtered_tools.append(tool)
                elif isinstance(tool, dict):
                    if tool.get('name', '').lower() != 'search':
                        filtered_tools.append(tool)
                else:
                    filtered_tools.append(tool)

            tools = filtered_tools
            agent_data[
                'prompt'] = f"{agent_data.get('prompt', '')}\n\nNote: The search tool was removed from this agent because no brain_documents or brain_relations were provided. If your response requires information retrieval, indicate that you cannot perform that action due to lack of documents."
            logger.warning(
                f"Removed search tool from agent '{agent_data.get('name', 'unknown')}' due to empty brain_documents and brain_relations"
            )
        return agent_data, tools
