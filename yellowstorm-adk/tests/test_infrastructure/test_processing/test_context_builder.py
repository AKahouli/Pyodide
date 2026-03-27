"""Tests for ContextBuilder."""

import pytest
from unittest.mock import MagicMock

from src.smart_rag.infrastructure.processing.context_builder import ContextBuilder


class TestContextBuilder:
    """Test cases for ContextBuilder."""

    def test_init(self):
        """Test context builder initialization."""
        builder = ContextBuilder()
        assert builder is not None

    def test_create_additional_context_from_events_empty_list(self):
        """Test creating context from empty events list."""
        result = ContextBuilder.create_additional_context_from_events([])
        assert result == ""

    def test_create_additional_context_from_events_none(self):
        """Test creating context from None events."""
        result = ContextBuilder.create_additional_context_from_events(None)
        assert result == ""

    def test_create_additional_context_from_events_no_valid_events(self):
        """Test creating context from events with no valid content."""
        # Create events without proper content structure
        events = [
            MagicMock(),  # Event without content
            MagicMock(content=None),  # Event with None content
            MagicMock(content=MagicMock(parts=[])),  # Event with empty parts
        ]

        result = ContextBuilder.create_additional_context_from_events(events)
        assert result == ""

    def test_create_additional_context_from_events_user_message_only(self):
        """Test creating context with only user message."""
        # Create event with user message
        event = MagicMock()
        event.content = MagicMock()
        event.content.role = "user"
        event.author = "user123"

        part = MagicMock()
        part.text = "What is machine learning?"
        part.function_response = None
        event.content.parts = [part]

        events = [event]

        result = ContextBuilder.create_additional_context_from_events(events, for_manager=True)

        assert "<main_task>What is machine learning?</main_task>" in result
        assert result == "<main_task>What is machine learning?</main_task>"

    def test_create_additional_context_from_events_with_agent_responses(self):
        """Test creating context with agent responses for manager."""
        events = []

        # User message
        user_event = MagicMock()
        user_event.content = MagicMock()
        user_event.content.role = "user"
        user_event.author = "user123"
        user_part = MagicMock()
        user_part.text = "Search for documents about AI"
        user_part.function_response = None
        user_event.content.parts = [user_part]
        events.append(user_event)

        # Agent response via function_response
        agent_event = MagicMock()
        agent_event.content = MagicMock()
        agent_event.content.role = "model"
        agent_event.author = "SearchAgent"
        agent_part = MagicMock()
        agent_part.text = None
        agent_part.function_response = MagicMock()
        agent_part.function_response.response = "Found 5 documents about AI"
        agent_event.content.parts = [agent_part]
        events.append(agent_event)

        result = ContextBuilder.create_additional_context_from_events(events, for_manager=True)

        assert "<main_task>Search for documents about AI</main_task>" in result
        assert "<agent_response>Found 5 documents about AI</agent_response>" in result

    def test_create_additional_context_from_events_with_manager_responses(self):
        """Test creating context with manager responses for regular agent."""
        events = []

        # User message
        user_event = MagicMock()
        user_event.content = MagicMock()
        user_event.content.role = "user"
        user_event.author = "user123"
        user_part = MagicMock()
        user_part.text = "Analyze the search results"
        user_part.function_response = None
        user_event.content.parts = [user_part]
        events.append(user_event)

        # Manager response
        manager_event = MagicMock()
        manager_event.content = MagicMock()
        manager_event.content.role = "model"
        manager_event.author = "manager_agent"  # MANAGER_AGENT_NAME
        manager_part = MagicMock()
        manager_part.text = "I'll delegate this analysis task to the appropriate agent"
        manager_part.function_response = None
        manager_event.content.parts = [manager_part]
        events.append(manager_event)

        result = ContextBuilder.create_additional_context_from_events(events, for_manager=False)

        assert "<main_task>Analyze the search results</main_task>" in result
        assert "<manager_agent>I'll delegate this analysis task to the appropriate agent</manager_agent>" in result

    def test_create_additional_context_from_events_filters_json_suggestions(self):
        """Test that JSON suggestions are filtered out."""
        events = []

        # User message
        user_event = MagicMock()
        user_event.content = MagicMock()
        user_event.content.role = "user"
        user_event.author = "user123"
        user_part = MagicMock()
        user_part.text = "Help me with analysis"
        user_part.function_response = None
        user_event.content.parts = [user_part]
        events.append(user_event)

        # JSON suggestions (should be filtered)
        suggestions_event = MagicMock()
        suggestions_event.content = MagicMock()
        suggestions_event.content.role = "model"
        suggestions_event.author = "system"
        suggestions_part = MagicMock()
        suggestions_part.text = '{"suggestions": [{"name": "Agent1"}]}'
        suggestions_part.function_response = None
        suggestions_event.content.parts = [suggestions_part]
        events.append(suggestions_event)

        result = ContextBuilder.create_additional_context_from_events(events, for_manager=True)

        assert "<main_task>Help me with analysis</main_task>" in result
        assert "suggestions" not in result
        assert result == "<main_task>Help me with analysis</main_task>"

    def test_create_additional_context_from_events_filters_empty_text(self):
        """Test that empty text is filtered out."""
        events = []

        # User message
        user_event = MagicMock()
        user_event.content = MagicMock()
        user_event.content.role = "user"
        user_event.author = "user123"
        user_part = MagicMock()
        user_part.text = "Valid message"
        user_part.function_response = None
        user_event.content.parts = [user_part]
        events.append(user_event)

        # Empty text event (should be filtered)
        empty_event = MagicMock()
        empty_event.content = MagicMock()
        empty_event.content.role = "model"
        empty_event.author = "agent"
        empty_part = MagicMock()
        empty_part.text = "   "  # Only whitespace
        empty_part.function_response = None
        empty_event.content.parts = [empty_part]
        events.append(empty_event)

        result = ContextBuilder.create_additional_context_from_events(events, for_manager=True)

        assert result == "<main_task>Valid message</main_task>"

    def test_create_additional_context_from_events_complex_scenario(self):
        """Test creating context with mixed event types."""
        events = []

        # User message
        user_event = MagicMock()
        user_event.content = MagicMock()
        user_event.content.role = "user"
        user_event.author = "user123"
        user_part = MagicMock()
        user_part.text = "Find and analyze documents about renewable energy"
        user_part.function_response = None
        user_event.content.parts = [user_part]
        events.append(user_event)

        # Manager response
        manager_event = MagicMock()
        manager_event.content = MagicMock()
        manager_event.content.role = "model"
        manager_event.author = "manager_agent"
        manager_part = MagicMock()
        manager_part.text = "I'll search for documents first, then analyze them"
        manager_part.function_response = None
        manager_event.content.parts = [manager_part]
        events.append(manager_event)

        # Agent function response
        agent_event = MagicMock()
        agent_event.content = MagicMock()
        agent_event.content.role = "model"
        agent_event.author = "SearchAgent"
        agent_part = MagicMock()
        agent_part.text = None
        agent_part.function_response = MagicMock()
        agent_part.function_response.response = "Found 10 documents about renewable energy"
        agent_event.content.parts = [agent_part]
        events.append(agent_event)

        # Test for regular agent (gets both manager and agent responses)
        result_for_agent = ContextBuilder.create_additional_context_from_events(events, for_manager=False)

        assert "<main_task>Find and analyze documents about renewable energy</main_task>" in result_for_agent
        assert "<manager_agent>I'll search for documents first, then analyze them</manager_agent>" in result_for_agent
        assert "<agent_response>Found 10 documents about renewable energy</agent_response>" in result_for_agent

        # Test for manager (gets only agent responses)
        result_for_manager = ContextBuilder.create_additional_context_from_events(events, for_manager=True)

        assert "<main_task>Find and analyze documents about renewable energy</main_task>" in result_for_manager
        assert "<manager_agent>" not in result_for_manager
        assert "<agent_response>Found 10 documents about renewable energy</agent_response>" in result_for_manager

    def test_create_additional_context_from_events_max_context_items(self):
        """Test that context is limited by MAX_CONTEXT_ITEMS."""
        events = []

        # User message
        user_event = MagicMock()
        user_event.content = MagicMock()
        user_event.content.role = "user"
        user_event.author = "user123"
        user_part = MagicMock()
        user_part.text = "Process multiple documents"
        user_part.function_response = None
        user_event.content.parts = [user_part]
        events.append(user_event)

        # Create more agent responses than MAX_CONTEXT_ITEMS (which is 10)
        for i in range(15):  # Create 15 responses to exceed the limit
            agent_event = MagicMock()
            agent_event.content = MagicMock()
            agent_event.content.role = "model"
            agent_event.author = f"Agent{i}"
            agent_part = MagicMock()
            agent_part.text = None
            agent_part.function_response = MagicMock()
            agent_part.function_response.response = f"Response {i}"
            agent_event.content.parts = [agent_part]
            events.append(agent_event)

        result = ContextBuilder.create_additional_context_from_events(events, for_manager=True)

        # Should contain main task
        assert "<main_task>Process multiple documents</main_task>" in result

        # Should contain some but not all responses (limited by MAX_CONTEXT_ITEMS)
        response_count = result.count("<agent_response>")
        assert response_count <= 10  # Should be limited by MAX_CONTEXT_ITEMS (which is 10)

        # Should contain the latest responses (5-14, the last 10)
        assert "Response 14</agent_response>" in result
        assert "Response 13</agent_response>" in result
        assert "Response 5</agent_response>" in result  # Should include from index 5
        assert "Response 0</agent_response>" not in result  # Early responses should be filtered out
        assert "Response 1</agent_response>" not in result
        assert "Response 2</agent_response>" not in result
        assert "Response 3</agent_response>" not in result
        assert "Response 4</agent_response>" not in result  # First 5 responses should be filtered out

    def test_create_additional_context_from_events_method_is_static(self):
        """Test that create_additional_context_from_events is a static method."""
        import inspect

        # Should be able to call without instantiating the class
        result = ContextBuilder.create_additional_context_from_events([])
        assert result == ""

        # Verify it's actually a static method
        assert inspect.isfunction(ContextBuilder.create_additional_context_from_events)