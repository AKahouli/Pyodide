"""Agent repository for managing collections of agents.

This module provides a centralized repository for storing, retrieving, and managing
agents within the smart RAG system. It handles agent metadata, search capabilities,
and provides normalized access methods.

Classes:
    AgentRepository: Main repository class for agent management operations.
"""

from typing import Dict, Any, Optional, List
from src.logger.logging import get_logger

logger = get_logger("api.routers.agentic_rag.AgentRepository")


class AgentRepository:
    """Manages the collection of agents and provides access methods.
    
    This class serves as a centralized repository for storing and managing
    agent configurations. It provides methods for adding, retrieving, and
    querying agents by various criteria including name-based lookups and
    capability-based filtering.
    
    Attributes:
        agents (List[Dict[str, Any]]): List of agent configuration dictionaries.
        _helper (AgentHelper): Helper instance for agent-related operations.
    """

    def __init__(self,agent_helper):
        """Initialize the agent repository.
        
        Creates an empty repository and initializes the agent helper for
        name normalization and other agent operations.
        """
        self.agents = []
        self._helper = agent_helper

    def add_agent(self, agent: Dict[str, Any]) -> None:
        """Add an agent to the repository.
        
        Args:
            agent (Dict[str, Any]): Agent configuration dictionary containing
                metadata, capabilities, tools, and other agent properties.
        
        Returns:
            None
        """
        self.agents.append(agent)

    def set_agents(self, agents: List[Dict[str, Any]]) -> None:
        """Set the entire list of agents.
        
        Replaces the current agent collection with the provided list.
        Used for bulk updates or initialization from external sources.
        
        Args:
            agents (List[Dict[str, Any]]): List of agent configuration dictionaries
                to replace the current collection.
        
        Returns:
            None
        """
        self.agents = agents

    def get_agent_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """Get an agent by its name.
        
        Performs a normalized name comparison to find the specified agent.
        The search is case-insensitive and handles various name formatting
        conventions through normalization.
        
        Args:
            name (str): The name of the agent to retrieve.
        
        Returns:
            Optional[Dict[str, Any]]: Agent configuration dictionary if found,
                None if no agent with the specified name exists.
        """
        normalized_name = self._helper.normalize_agent_name(name)

        for agent in self.agents:
            agent_name = self._get_normalized_agent_name(agent)
            if agent_name == normalized_name:
                return agent

        return None

    def get_agent_id_by_name(self, name: str) -> Optional[str]:
        """Get an agent's ID by its name.
        
        Retrieves the unique identifier for an agent based on its name.
        Returns a default value if the agent is found but has no ID.
        
        Args:
            name (str): The name of the agent whose ID is needed.
        
        Returns:
            Optional[str]: The agent's unique identifier if found and has an ID,
                'no-id' if agent found but has no ID, None if agent not found.
        """
        agent = self.get_agent_by_name(name)
        if agent:
            return agent.get('id')
        return "no_id"

    def get_all_agents(self) -> List[Dict[str, Any]]:
        """Get all agents.
        
        Returns the complete collection of agents stored in the repository.
        
        Returns:
            List[Dict[str, Any]]: List of all agent configuration dictionaries
                currently stored in the repository.
        """
        return self.agents

    def has_search_agents(self) -> bool:
        """Check if any of the current agents have search tools.

        Scans all agents in the repository to determine if any have search
        capabilities based on their tool configurations.

        Returns:
            bool: True if at least one agent has search tools available,
                False if no agents have search capabilities.
        """
        for agent in self.agents:
            tools = agent.get('tools', []) or []
            for tool in tools:
                if isinstance(tool, dict) and tool.get('name', '').lower() == 'search':
                    return True
                elif isinstance(tool, str) and tool.lower() == 'search':
                    return True
        return False

    def has_code_interpreter(self) -> bool:
        """Check if any of the current agents have search tools.

        Scans all agents in the repository to determine if any have search
        capabilities based on their tool configurations.

        Returns:
            bool: True if at least one agent has search tools available,
                False if no agents have search capabilities.
        """
        for agent in self.agents:
            tools = agent.get('tools', []) or []
            for tool in tools:
                if isinstance(tool, dict) and tool.get('name', '').lower() == 'code interpreter':
                    return True
                elif isinstance(tool, str) and tool.lower() == 'code interpreter':
                    return True
        return False

    def _get_normalized_agent_name(self, agent: Dict[str, Any]) -> str:
        """Get normalized name from agent.
        
        Extracts and normalizes the agent name for consistent comparison.
        Handles both dictionary and object-style agent representations.
        
        Args:
            agent (Dict[str, Any]): Agent configuration dictionary or object.
        
        Returns:
            str: Normalized agent name suitable for comparison operations.
        """
        if isinstance(agent, dict):
            return self._helper.normalize_agent_name(agent.get('name', ''))
        return self._helper.normalize_agent_name(getattr(agent, 'name', ''))