"""
Event Extractor Module

Handles extraction of information from various types of events during agent execution.
"""

from typing import Optional
from google.genai import types
from src.logger.logging import get_logger

logger = get_logger("api.smart_rag.event_extractor")


class EventExtractor:
    """Handles extraction of information from events.

    Methods:
        * extract_function_call_info: Extract function call details.
        * extract_function_response_info: Extract function response details.
        * extract_text_content: Extract text content from event.
        * extract_agent_name: Extract agent name from event.
        * is_final_response: Check if event is a final response.
        * has_function_call: Check if event contains a function call.
        * has_function_response: Check if event contains a function response.
        * extract_function_name: Extract function name from function call part.
        * extract_function_args: Extract function arguments from function call part.
        * extract_error_info: Extract error information if present.
        * extract_comprehensive_event_info: Extract comprehensive information from event.
    """

    @staticmethod
    def extract_function_call_info(event, part: Optional[types.Part] = None) -> str:
        """Extract function call information from event."""
        try:
            agent_name = getattr(event, 'author', 'Unknown Agent')
            
            if part and hasattr(part, 'function_call'):
                function_call = part.function_call
            elif hasattr(event, 'content') and event.content and event.content.parts:
                function_call = event.content.parts[0].function_call
            else:
                return f"Agent '{agent_name}' called unknown function"

            function_name = getattr(function_call, 'name', str(function_call))
            function_args = getattr(function_call, 'args', {})
            
            return f"Agent '{agent_name}' called function: {function_name} with args {str(function_args)}"
            
        except Exception as e:
            logger.error(f"Error extracting function call info: {str(e)}")
            return "Function call information extraction failed"

    @staticmethod
    def extract_function_response_info(event) -> str:
        """Extract function response information from event."""
        try:
            agent_name = getattr(event, 'author', 'Unknown Agent')
            
            if (hasattr(event, 'content') and event.content and event.content.parts and
                hasattr(event.content.parts[0], 'function_response')):
                function_response = event.content.parts[0].function_response.response
                response_text = str(function_response)
            else:
                response_text = "No response data available"
            
            return f"Agent '{agent_name}' received function response: {response_text}"
            
        except Exception as e:
            logger.error(f"Error extracting function response info: {str(e)}")
            return "Function response information extraction failed"

    @staticmethod
    def extract_text_content(event) -> str:
        """Extract text content from event."""
        try:
            if hasattr(event, 'content') and event.content and event.content.parts:
                for part in event.content.parts:
                    if hasattr(part, 'text') and part.text:
                        return part.text
            return ""
        except Exception as e:
            logger.error(f"Error extracting text content: {str(e)}")
            return ""

    @staticmethod
    def extract_agent_name(event) -> str:
        """Extract agent name from event."""
        try:
            return getattr(event, 'author', 'Unknown Agent')
        except Exception as e:
            logger.error(f"Error extracting agent name: {str(e)}")
            return "Unknown Agent"

    @staticmethod
    def is_final_response(event) -> bool:
        """Check if event represents a final response."""
        try:
            return hasattr(event, 'is_final_response') and event.is_final_response()
        except Exception as e:
            logger.error(f"Error checking final response status: {str(e)}")
            return False

    @staticmethod
    def has_function_call(event) -> bool:
        """Check if event contains a function call."""
        try:
            if hasattr(event, 'content') and event.content and event.content.parts:
                for part in event.content.parts:
                    if hasattr(part, 'function_call') and part.function_call:
                        return True
            return False
        except Exception as e:
            logger.error(f"Error checking function call presence: {str(e)}")
            return False

    @staticmethod
    def has_function_response(event) -> bool:
        """Check if event contains a function response."""
        try:
            if hasattr(event, 'content') and event.content and event.content.parts:
                for part in event.content.parts:
                    if hasattr(part, 'function_response') and part.function_response:
                        return True
            return False
        except Exception as e:
            logger.error(f"Error checking function response presence: {str(e)}")
            return False

    @staticmethod
    def extract_function_name(part) -> str:
        """Extract function name from a part containing function call."""
        try:
            if hasattr(part, 'function_call') and part.function_call:
                return getattr(part.function_call, 'name', 'unknown_function')
            return 'unknown_function'
        except Exception as e:
            logger.error(f"Error extracting function name: {str(e)}")
            return 'unknown_function'

    @staticmethod
    def extract_function_args(part) -> dict:
        """Extract function arguments from a part containing function call."""
        try:
            if hasattr(part, 'function_call') and part.function_call:
                args = getattr(part.function_call, 'args', {})
                return dict(args) if args else {}
            return {}
        except Exception as e:
            logger.error(f"Error extracting function args: {str(e)}")
            return {}

    @staticmethod
    def extract_error_info(event) -> Optional[str]:
        """Extract error information if present."""
        try:
            # Check for error in function response
            if hasattr(event, 'content') and event.content and event.content.parts:
                for part in event.content.parts:
                    if (hasattr(part, 'function_response') and 
                        hasattr(part.function_response, 'is_error') and 
                        part.function_response.is_error):
                        return str(part.function_response.response)
            
            # Check for other error indicators
            if hasattr(event, 'error') and event.error:
                return str(event.error)
                
            return None
        except Exception as e:
            logger.error(f"Error extracting error info: {str(e)}")
            return None

    @classmethod
    def extract_comprehensive_event_info(cls, event) -> dict:
        """Extract comprehensive information from an event."""
        try:
            return {
                'agent_name': cls.extract_agent_name(event),
                'text_content': cls.extract_text_content(event),
                'is_final': cls.is_final_response(event),
                'has_function_call': cls.has_function_call(event),
                'has_function_response': cls.has_function_response(event),
                'function_call_info': cls.extract_function_call_info(event) if cls.has_function_call(event) else None,
                'function_response_info': cls.extract_function_response_info(event) if cls.has_function_response(event) else None,
                'error_info': cls.extract_error_info(event)
            }
        except Exception as e:
            logger.error(f"Error extracting comprehensive event info: {str(e)}")
            return {
                'agent_name': 'Unknown Agent',
                'text_content': '',
                'is_final': False,
                'has_function_call': False,
                'has_function_response': False,
                'function_call_info': None,
                'function_response_info': None,
                'error_info': f"Event extraction failed: {str(e)}"
            }