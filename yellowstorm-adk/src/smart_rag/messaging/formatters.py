"""
Streaming Formatter Module

Handles formatting of streaming events and responses for client consumption.
"""
import uuid
from typing import Dict, Any, List, Optional
import json
from src.logger.logging import get_logger
import re2 as re
from src.smart_rag.messaging.component_tracker import ComponentTracker

logger = get_logger("api.smart_rag.streaming_formatter")


class StreamingFormatter:
    """Handles formatting of streaming events."""

    def __init__(self, component_tracker: Optional[ComponentTracker] = None):
        """Initialize StreamingFormatter with optional component tracker.

        Args:
            component_tracker: ComponentTracker instance for tracking add/update actions
        """
        self.component_tracker = component_tracker

    def agent_name_stream(self,agent_name: str) -> str:
        """Normalize user-provided agent names for display."""

        # 1. Normalize separators to spaces (underscore, dash, etc.)
        name = re.sub(r"[_\-]+", " ", agent_name)

        # 2. Insert a space before 'agent' when attached (case-insensitive)
        name = re.sub(r"(?i)([a-zA-Z0-9])agent\b", r"\1 Agent", name)

        # 3. Remove any character not alphanumeric or apostrophe or space
        name = re.sub(r"[^\w' ]+", "", name)

        # 4. Collapse multiple spaces
        name = " ".join(name.split())

        # 5. Title-case each word but preserve internal apostrophes (e.g., O'Neil)
        def smart_cap(word):
            if "'" in word:
                parts = word.split("'")
                return "'".join(p.capitalize() for p in parts)
            return word.capitalize()

        pretty = " ".join(smart_cap(w) for w in name.split())

        return pretty

    def format_component_event(self, agent_id: str, component_type: str,
                              component_data: Dict[str, Any], message_id: str,
                              action: str = None, component_id: str = None) -> Dict[str, Any]:
        """Format a streaming event using the new component-based structure.

        Args:
            agent_id: Agent ID
            component_type: Component type (text, code, reasoning, plan, chart, etc.)
            component_data: Dictionary with component-specific fields
                - For "text": {"content": "..."}
                - For "task": {"title": "...", "items": [{"text": "..."}], "status": "in_progress"}
                - For "code": {"content": "...", "language": "python", "filename": "..."}
                - etc.
            message_id: Message/session ID
            action: Optional action override ("add" or "update"). If not provided, auto-determined.
            component_id: Optional component ID override. If not provided, auto-generated.

        Returns:
            Dictionary with action, component, and metadata
        """
        # Determine action (add or update) and component ID
        # Priority: Use provided values, then auto-determine missing ones

        # If component_id is explicitly provided, use it (manual mode for sandbox, etc.)
        if component_id is not None:
            # Component ID provided - use it (manual mode for sandbox, etc.)
            # If action not provided, default to "add" for first send
            if action is None:
                action = "add"
        elif self.component_tracker:
            # No component_id override - use component tracker
            component_id, resolved_action = self.component_tracker.resolve(agent_id, component_type)
            if action is None:
                action = resolved_action
        else:
            # Fallback if no tracker (always add, generate new ID)
            action = "add" if action is None else action
            component_id = str(uuid.uuid4())

        return {
            "action": action,
            "component": {
                "id": component_id,
                "type": component_type,
                "data": component_data
            },
            "metadata": {
                "message_id": message_id,
                "agent_id": agent_id
            }
        }

    def format_plan_events(self, agent_id: str, component_data: Dict[str, Any],
                           message_id: str) -> List[Dict[str, Any]]:
        """Format plan component events using delete+add pattern.

        Delegates to the component tracker's resolve_plan() to determine
        whether to send a single "add" (first time) or "delete" then "add"
        (subsequent times). The plan keeps the same component_id for the
        entire session.

        Args:
            agent_id: Agent ID
            component_data: Plan data dictionary
            message_id: Message/session ID

        Returns:
            List of event dicts to send in order.
        """
        if not self.component_tracker:
            component_id = str(uuid.uuid4())
            return [self._build_event("add", component_id, "plan", component_data, message_id, agent_id)]

        actions = self.component_tracker.resolve_plan()
        events = []
        for action, component_id in actions:
            events.append(self._build_event(action, component_id, "plan", component_data, message_id, agent_id))
        return events

    def _build_event(self, action: str, component_id: str, component_type: str,
                     component_data: Dict[str, Any], message_id: str, agent_id: str) -> Dict[str, Any]:
        """Build a single component event dict."""
        return {
            "action": action,
            "component": {
                "id": component_id,
                "type": component_type,
                "data": component_data
            },
            "metadata": {
                "message_id": message_id,
                "agent_id": agent_id
            }
        }

    def format_streaming_event(self, agent_name: str, agent_type: str, chunk: str,
                               message_id: str, content_type: str = "chunk",
                               agent_id: str = "no_id",chunk_order=0) -> Dict[str, Any]:
        """Format the streaming event into a dictionary.

        This method provides backward compatibility with the old format while
        automatically using the new component-based format when ComponentTracker is available.
        """
        # If we have a component tracker, use the new format
        if self.component_tracker and agent_id != "no_id":
            # Map old content_type to component type
            component_type_map = {
                "chunk": "text",
                "description": "task",  # Changed from "plan" to "task"
                "source": "text",
                "final_response": "text",
                "ui": "chart",
                "File": "text",
                "error": "text"
            }
            component_type = component_type_map.get(content_type, "text")

            # Build component data based on type
            if component_type == "task":
                component_data = {
                    "title": agent_name,
                    "items": [{"text": chunk}],  # Task component expects items array
                    "status": "in_progress"  # Task component uses in_progress instead of active
                }
            else:
                component_data = {"content": chunk}

            # Use new format
            return self.format_component_event(
                agent_id=agent_id,
                component_type=component_type,
                component_data=component_data,
                message_id=message_id
            )

        # Fallback to old format for backward compatibility
        agent_name_stream = self.agent_name_stream(agent_name)

        formatted_event = {
            "agent_id": agent_id,
            "agent_name": agent_name_stream,
            "agent_type": agent_type,
            "chunk": chunk,
            "message_id": message_id,
            "message_type": "streaming",
            "content_type": content_type,
            "chunk_order": chunk_order,
            "chunk_id": str(uuid.uuid4())
        }
        return formatted_event

    @staticmethod
    def format_task_description_event(agent_name: str, agent_type: str,
                                    task_description: str, message_id: str,
                                    agent_id: str = "no_id") -> Dict[str, Any]:
        """Format a task description event."""
        formatter = StreamingFormatter()
        agent_name_stream = formatter.agent_name_stream(agent_name)
        return formatter.format_streaming_event(
            agent_name=agent_name_stream,
            agent_type=agent_type,
            chunk=task_description,
            message_id=message_id,
            content_type="description",
            agent_id=agent_id
        )


    @staticmethod
    def format_search_event(agent_name: str, search_type: str, query: str,
                          message_id: str, additional_filters: str = "",
                          agent_id: str = "no_id", component_id: str = None) -> Dict[str, Any]:
        """Format a search operation event.

        Args:
            agent_name: Name of the agent
            search_type: Type of search ("internal" or "web")
            query: Search query string
            message_id: Message/session ID
            additional_filters: Optional additional filters to display
            agent_id: Agent ID
            component_id: Optional component ID to update existing text component instead of creating new one

        Returns:
            Dictionary with formatted search event
        """
        formatter = StreamingFormatter()
        agent_name_stream = formatter.agent_name_stream(agent_name)
        search_icon = "🔎" if search_type == "internal" else "🌐"
        search_desc = "recherche interne" if search_type == "internal" else "web search"

        # Add line breaks before search notification if appending to existing component
        line_break_prefix = "\n\n" if component_id else ""
        chunk = f"{line_break_prefix}{search_icon} {search_desc} : {query}{additional_filters}\n\n"

        # If component_id provided, use format_component_event to update existing component
        if component_id:
            return formatter.format_component_event(
                agent_id=agent_id,
                component_type="text",
                component_data={"content": chunk},
                message_id=message_id,
                action="update",
                component_id=component_id
            )

        # Otherwise use regular streaming event (creates new component)
        return formatter.format_streaming_event(
            agent_name=agent_name_stream,
            agent_type="agent",
            chunk=chunk,
            message_id=message_id,
            content_type="chunk",
            agent_id=agent_id
        )

    @staticmethod
    def format_calculation_event(agent_name: str, expression: str,
                               message_id: str, agent_id: str = "no_id") -> Dict[str, Any]:
        """Format a calculation event."""
        chunk = f"Calculating: {expression}"
        formatter = StreamingFormatter()
        agent_name_stream = formatter.agent_name_stream(agent_name)
        return formatter.format_streaming_event(
            agent_id=agent_id,
            agent_name=agent_name_stream,
            agent_type="agent",
            chunk=chunk,
            message_id=message_id,
            content_type="chunk"
        )

    @staticmethod
    def format_source_event(agent_name: str, source_data: Any,
                          message_id: str, agent_id: str = "no_id") -> Dict[str, Any]:
        """Format a source information event."""
        try:
            source_json = json.dumps(source_data) if source_data else json.dumps([])
        except (TypeError, ValueError):
            source_json = json.dumps([])

        formatter = StreamingFormatter()
        agent_name_stream = formatter.agent_name_stream(agent_name)
        return formatter.format_streaming_event(
            agent_id=agent_id,
            agent_name=agent_name_stream,
            agent_type="agent",
            chunk=source_json,
            message_id=message_id,
            content_type="source"
        )

    @staticmethod
    def format_file_event(agent_name: str, file_data: Dict,
                        message_id: str, agent_id: str = "no_id") -> Dict[str, Any]:
        """Format a file upload/processing event."""
        try:
            file_json = json.dumps(file_data)
        except (TypeError, ValueError):
            file_json = json.dumps({"error": "Failed to serialize file data"})

        formatter = StreamingFormatter()
        return formatter.format_streaming_event(
            agent_id=agent_id,
            agent_name=agent_name,
            agent_type="agent",
            chunk=file_json,
            message_id=message_id,
            content_type="File"
        )

    @staticmethod
    def format_error_event(agent_name: str, error_message: str,
                         message_id: str, agent_id: str = "no_id") -> Dict[str, Any]:
        """Format an error event."""
        formatter = StreamingFormatter()
        agent_name_stream = formatter.agent_name_stream(agent_name)
        return formatter.format_streaming_event(
            agent_id=agent_id,
            agent_name=agent_name_stream,
            agent_type="agent",
            chunk=f"Error: {error_message}",
            message_id=message_id,
            content_type="error"
        )

    @staticmethod
    def format_final_response_event(agent_name: str, message_id: str,
                                  agent_id: str = "no_id") -> Dict[str, Any]:
        """Format a final response completion event."""
        formatter = StreamingFormatter()
        agent_name_stream = formatter.agent_name_stream(agent_name)
        return formatter.format_streaming_event(
            agent_id=agent_id,
            agent_name=agent_name_stream,
            agent_type="manager",
            chunk="end_of_message",
            message_id=message_id,
            content_type="final_response"
        )

    @staticmethod
    def format_html_chunk_event(chunk: str, message_id: str,
                              agent_id: str = "no_id") -> Dict[str, Any]:
        """Format an HTML content chunk event."""
        formatter = StreamingFormatter()
        return formatter.format_streaming_event(
            agent_id=agent_id,
            agent_name="HtmlAgent",
            agent_type="html",
            chunk=str(chunk),
            message_id=message_id,
            content_type="chunk"
        )

    @staticmethod
    def split_and_format_large_content(content: str, message_id: str,
                                     agent_name: str = "HtmlAgent",
                                     agent_type: str = "html",
                                     chunk_size: int = 250,
                                     agent_id: str = "no_id") -> list:
        """Split large content into chunks and format each as an event."""
        formatter = StreamingFormatter()
        agent_name_stream = formatter.agent_name_stream(agent_name)
        if len(content) <= chunk_size:
            return [formatter.format_streaming_event(
                agent_id=agent_id,
                agent_name=agent_name_stream,
                agent_type=agent_type,
                chunk=content,
                message_id=message_id,
                content_type="chunk"
            )]

        chunks = [content[i:i + chunk_size] for i in range(0, len(content), chunk_size)]
        return [
            formatter.format_streaming_event(
                agent_id=agent_id,
                agent_name=agent_name_stream,
                agent_type=agent_type,
                chunk=chunk,
                message_id=message_id,
                content_type="chunk"
            )
            for chunk in chunks
        ]

    @classmethod
    def create_search_events_for_function(cls, function_name: str, args: Dict,
                                        agent_name: str, message_id: str,
                                        agent_id: str = "no_id", component_id: str = None) -> Optional[Dict[str, Any]]:
        """Create appropriate search events based on function name and arguments.

        Args:
            function_name: Name of the function being called
            args: Function arguments
            agent_name: Name of the agent
            message_id: Message/session ID
            agent_id: Agent ID
            component_id: Optional component ID to update existing text component

        Returns:
            Dictionary with formatted search event or None
        """
        agent_name_stream=StreamingFormatter().agent_name_stream(agent_name)
        try:
            if function_name=="HtmlAgent":
                return cls.format_html_chunk_event(
                    chunk=args.get('content', ''),
                    message_id=message_id,
                    agent_id=agent_id
                )
            if function_name == "perform_document_search":
                search_filter = ""
                for arg_key, arg_value in args.items():
                    if arg_key not in ["query", "id"]:
                        search_filter += f"{arg_value}, "

                query = args.get('query', '')
                if isinstance(query, list):
                    query = ' '.join(str(item) for item in query)
                else:
                    query = str(query)

                return cls.format_search_event(
                    agent_name=agent_name_stream,
                    search_type="internal",
                    query=query + search_filter,
                    message_id=message_id,
                    agent_id=agent_id,
                    component_id=component_id
                )

            elif function_name == "perform_web_search":
                query = args.get('query', '')
                if isinstance(query, list):
                    query = ' '.join(str(item) for item in query)
                else:
                    query = str(query)

                return cls.format_search_event(
                    agent_name=agent_name_stream,
                    search_type="web",
                    query=query,
                    message_id=message_id,
                    agent_id=agent_id,
                    component_id=component_id
                )

            elif function_name == "perform_standard_search":
                query = args.get('query', '')
                if isinstance(query, list):
                    query = ' '.join(str(item) for item in query)
                else:
                    query = str(query)

                return cls.format_search_event(
                    agent_name=agent_name_stream,
                    search_type="internal",
                    query=f"(all) {query}",
                    message_id=message_id,
                    agent_id=agent_id,
                    component_id=component_id
                )

            elif function_name == "calculator":
                expression = args.get('expression', '')
                return cls.format_calculation_event(
                    agent_name=agent_name_stream,
                    expression=expression,
                    message_id=message_id,
                    agent_id=agent_id
                )

            return None

        except Exception as e:
            logger.error(f"Error creating search events for function {function_name}: {str(e)}")
            return None

    @staticmethod
    def validate_event_format(event: Dict[str, Any]) -> bool:
        """Validate that an event has the required format."""
        required_fields = ["agent_name", "agent_type", "chunk", "message_id", "message_type", "content_type"]
        return all(field in event for field in required_fields)