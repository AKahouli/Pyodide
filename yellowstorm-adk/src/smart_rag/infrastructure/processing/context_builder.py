"""Context builder for creating agent context from session events.

This module provides functionality to extract and format conversation context
from session events, enabling agents to maintain continuity and understanding
across multi-turn interactions.

Classes:
    ContextBuilder: Main class for building context from session events.
"""


from typing import List

from src.smart_rag.engines.multi_agent.config import MAX_CONTEXT_ITEMS, MANAGER_AGENT_NAME


class ContextBuilder:
    """Builds context for agents based on session events.
    
    This class processes session events to create structured context that agents
    can use to understand previous interactions, maintain conversation continuity,
    and make informed decisions based on conversation history.
    
    The context builder differentiates between manager agents and regular agents,
    providing appropriate context for each type based on their roles in the system.
    
    Methods:
        create_additional_context_from_events: Extracts and formats context from session events.
    """

    @staticmethod
    def create_additional_context_from_events(session_events: List, for_manager: bool = True) -> str:
        """Create additional context from session events for agents.
        
        Processes session events to extract relevant conversation history and formats
        it into structured context appropriate for the requesting agent type. Manager
        agents receive agent responses for coordination, while regular agents receive
        both manager and agent responses for comprehensive context.
        
        The method filters out empty messages, JSON suggestions, and other non-relevant
        content while preserving the essential conversation flow and responses.

        Args:
            session_events (List): List of session events containing conversation history.
            for_manager (bool): If True, build context for manager agent coordination;
                if False, build comprehensive context for regular agent execution.
                
        Returns:
            str: Formatted context string with structured XML-like tags containing
                relevant conversation history, empty string if no relevant events found.
        """
        if not session_events:
            return ""

        context_parts = []
        initial_user_message = None
        agent_responses = []
        manager_responses = []

        # Extract different types of messages
        for event in session_events:
            if not (hasattr(event, 'content') and event.content and hasattr(event.content, 'parts')):
                continue

            for part in event.content.parts:
                if hasattr(part, 'text') and part.text:
                    text = part.text.strip()
                    if not text or text.startswith('{"suggestions"'):
                        continue

                    author = getattr(event, 'author', 'unknown')
                    role = getattr(event.content, 'role', 'unknown')

                    if role == 'user' and initial_user_message is None:
                        initial_user_message = text
                    elif role == 'model' and author == MANAGER_AGENT_NAME:
                        manager_responses.append(f"<manager_agent>{text}</manager_agent>")

                elif hasattr(part, 'function_response'):
                    function_response = part.function_response
                    if hasattr(function_response, 'response'):
                        response_text = str(function_response.response).strip()
                        if response_text:
                            agent_responses.append(f"<agent_response>{response_text}</agent_response>")

        # Build context based on requester
        if initial_user_message:
            context_parts.append(f"<main_task>{initial_user_message}</main_task>")

        if for_manager:
            recent_agent_responses = agent_responses[-MAX_CONTEXT_ITEMS:] if len(
                agent_responses) > MAX_CONTEXT_ITEMS else agent_responses
            context_parts.extend(recent_agent_responses)
        else:
            recent_manager_responses = manager_responses[-MAX_CONTEXT_ITEMS:] if len(
                manager_responses) > MAX_CONTEXT_ITEMS else manager_responses
            recent_agent_responses = agent_responses[-MAX_CONTEXT_ITEMS:] if len(
                agent_responses) > MAX_CONTEXT_ITEMS else agent_responses
            context_parts.extend(recent_manager_responses)
            context_parts.extend(recent_agent_responses)

        return "\n\n".join(context_parts) if context_parts else ""

