"""Agent tools manager for extracting and creating agent delegation tools.

This module handles the creation of delegation tools that enable the manager agent
to call specialized agents. It processes user prompts to identify agent mentions
and creates appropriate delegation functions.

Classes:
    AgentToolsManager: Main manager for agent tool creation and extraction.
"""

import asyncio
import re2 as re
from typing import Dict, Any, Optional, List
from src.logger.logging import get_logger

logger = get_logger("api.routers.agentic_rag.AgentToolsManager")


class AgentToolsManager:
    """Manages extraction and creation of agent tools from user prompts.
    
    This class handles the creation of delegation tools that enable the manager agent
    to coordinate with specialized agents. It extracts agent mentions from user prompts
    and creates corresponding delegation functions with proper naming and configuration.
    
    Attributes:
        agent_repository: Repository for accessing agent configurations.
        delegation_factory: Factory for creating agent delegation functions.
        _helper: Helper for agent name sanitization and utilities.
    """

    def __init__(self, agent_repository, delegation_factory,agent_helper):
        """Initialize the agent tools manager.
        
        Args:
            agent_repository: Repository for storing and retrieving agent configurations.
            delegation_factory: Factory for creating agent delegation functions.
            agent_helper: Helper for agent name processing and utilities.
        """
        self.agent_repository = agent_repository
        self.delegation_factory = delegation_factory
        self._helper = agent_helper

    def extract_agent_tools_from_mentions(self, user_prompt: str, q: Optional[asyncio.Queue[dict]] = None,
                                          search_web: Optional[bool] = False) -> List[Any]:
        """Extract agent tools from @ mentions in user prompt.
        
        Parses the user prompt for @agent_name mentions and creates corresponding
        delegation tools for each mentioned agent that exists in the repository.
        
        Args:
            user_prompt (str): User prompt to scan for agent mentions.
            q (Optional[asyncio.Queue[dict]]): Queue for streaming responses.
            search_web (Optional[bool]): Whether agents should have web search capabilities.
            
        Returns:
            List[Any]: List of delegation functions for mentioned agents.
        """
        extracted_agent_names = []
        regex = re.compile(r"@([a-zA-Z_][a-zA-Z0-9_-]*)")
        matches = regex.findall(user_prompt)
        tools = []

        for match in matches:
            agent_name = match.strip()
            fix_agent_name = agent_name.replace(" ", "_").lower()
            agent_config = self.agent_repository.get_agent_by_name(fix_agent_name)
            if agent_config:
                extracted_agent_names.append(fix_agent_name)
                function_name = f"delegate_to_{self._helper.sanitize_function_name(fix_agent_name)}"
                delegate_func = self.delegation_factory.make_delegate_function(fix_agent_name, q, search_web)
                delegate_func.__name__ = function_name
                tools.append(delegate_func)

        return tools

    def create_tools_from_all_agents(self, q: Optional[asyncio.Queue[dict]] = None,
                                     search_web: Optional[bool] = False) -> List[Any]:
        """Create tools from all available agents.
        
        Creates delegation tools for every agent in the repository, enabling
        the manager agent to delegate to any available specialized agent.
        
        Args:
            q (Optional[asyncio.Queue[dict]]): Queue for streaming responses.
            search_web (Optional[bool]): Whether agents should have web search capabilities.
            
        Returns:
            List[Any]: List of delegation functions for all available agents.
        """
        tools = []
        for agent in self.agent_repository.get_all_agents():
            agent_name = agent.get('name', '').replace(" ", "_").lower()
            function_name = f"delegate_to_{self._helper.sanitize_function_name(agent_name)}"
            delegate_func = self.delegation_factory.make_delegate_function(agent_name, q, search_web)
            delegate_func.__name__ = function_name
            tools.append(delegate_func)
        return tools

    def get_agent_tools(self, user_prompt: str, q: Optional[asyncio.Queue[dict]] = None,
                        search_web: Optional[bool] = False) -> List[Any]:
        """Get agent tools either from mentions or all available agents."""
        tools = self.extract_agent_tools_from_mentions(user_prompt, q, search_web)

        if not tools:
            logger.warning("No valid agents found in user prompt, manager will select from available agents")
            tools = self.create_tools_from_all_agents(q, search_web)

            if not tools:
                logger.error("No agents available for manager to select from")
                raise ValueError("No agents available for manager")

        return tools

    def create_tools_for_agent_ids(self, agent_ids: List[str], q=None, search_web: bool = False) -> List[Any]:
        tools = []
        for agent_id in agent_ids:
            agent = self.agent_repository.get_agent_by_id(agent_id)
            if not agent:
                raise ValueError(f"Agent {agent_id} not found")
            agent_name = agent.get("name", "")
            delegate_func = self.delegation_factory.make_delegate_function(agent_name, q, search_web)
            delegate_func.__name__ = f"delegate_to_{self._helper.sanitize_function_name(agent_name)}"
            tools.append(delegate_func)
        return tools
