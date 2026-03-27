"""
Utility for accessing diagrams from the global reference tracker used by agents.

This module provides a simple interface to access the global reference tracker
instance and retrieve all stored diagrams and references for any session.
"""

import asyncio
from typing import Dict, List, Optional, Any

from src.logger.logging import get_logger
from src.smart_rag.infrastructure.diagram.reference_tracker import DiagramReferenceTracker

logger = get_logger("api.smart_rag.diagram_accessor")

# Global reference tracker instance (same as in base_factory.py)
_reference_tracker = DiagramReferenceTracker()


class DiagramAccessor:
    """
    Provides access to the global reference tracker instance used by all agents.

    This class allows you to retrieve all diagrams stored by any agent
    during their execution without recreating new reference tracker instances.
    """

    def __init__(self):
        """Initialize with access to the global reference tracker."""
        self.reference_tracker = _reference_tracker

    async def get_diagram(self, session_id: str, reference: int) -> Optional[Dict[str, Any]]:
        """
        Get a specific diagram by reference number.

        Args:
            session_id: The session identifier
            reference: The diagram reference number

        Returns:
            Diagram data dictionary or None if not found
        """
        return await self.reference_tracker.get_diagram(session_id, reference)

    async def get_diagram_references(self, session_id: str) -> List[str]:
        """
        Get all diagram reference tags for a session in order.

        Args:
            session_id: The session identifier

        Returns:
            List of reference tags (e.g., ["[diagram_1]", "[diagram_2]"])
        """
        return await self.reference_tracker.get_diagram_references(session_id)

    def get_session_summary(self, session_id: str) -> Dict[str, Any]:
        """
        Get a summary of all diagrams for a session.

        Args:
            session_id: The session identifier

        Returns:
            Dictionary containing total count, references, and diagram data
        """
        return self.reference_tracker.get_session_summary(session_id)

    async def ensure_session_exists(self, session_id: str):
        """
        Ensure the session exists in the reference tracker.

        Args:
            session_id: The session identifier
        """
        await self.reference_tracker.ensure_session(session_id)

    async def get_formatted_diagrams(self, session_id: str) -> List[Dict[str, Any]]:
        """
        Get all diagrams formatted for response inclusion.

        Args:
            session_id: The session identifier

        Returns:
            List of formatted diagram dictionaries ready for API responses
        """
        diagrams = await self.get_all_session_diagrams(session_id)
        formatted_diagrams = []

        for ref_num in sorted(diagrams.keys()):
            diagram_data = diagrams[ref_num]
            formatted_diagram = {
                "type": "diagram",
                "reference": f"[diagram_{ref_num}]",
                "title": diagram_data.get("title", f"Diagram {ref_num}"),
                "html_content": diagram_data.get("html_content", ""),
                "diagram_request": diagram_data.get("diagram_request", ""),
                "created_at": diagram_data.get("created_at", "")
            }
            formatted_diagrams.append(formatted_diagram)

        return formatted_diagrams

    @staticmethod
    async def extract_diagram_references(text: str) -> List[int]:
        """
        Extract diagram reference numbers from text.

        Args:
            text: Text containing diagram references

        Returns:
            List of reference numbers found in the text
        """
        import re2 as re
        diagram_refs = re.findall(r'\[diagram_(\d+)\]', text)
        return [int(ref) for ref in diagram_refs if ref.isdigit()]

    async def get_diagrams_for_text(self, session_id: str, text: str) -> List[Dict[str, Any]]:
        """
        Get all diagrams referenced in the given text.

        Args:
            session_id: The session identifier
            text: Text containing diagram references

        Returns:
            List of diagrams referenced in the text
        """
        ref_numbers = await self.extract_diagram_references(text)
        diagrams = []

        for ref_num in ref_numbers:
            diagram = await self.get_diagram(session_id, ref_num)
            if diagram:
                diagrams.append({
                    "type": "diagram",
                    "reference": f"[diagram_{ref_num}]",
                    "title": diagram.get("title", f"Diagram {ref_num}"),
                    "html_content": diagram.get("html_content", ""),
                    "diagram_request": diagram.get("diagram_request", ""),
                    "created_at": diagram.get("created_at", "")
                })

        return diagrams


# Singleton instance for easy access
_diagram_accessor = DiagramAccessor()


async def get_diagram_accessor() -> DiagramAccessor:
    """Get the global diagram accessor instance."""
    return _diagram_accessor


async def get_all_agent_diagrams(session_id: str) -> Dict[str, Any]:
    """
    Get all diagrams created by agents for a session.

    This is the main function to use when you want to retrieve all diagrams
    that have been created and stored by any agent during a session.

    Args:
        session_id: The session identifier

    Returns:
        Dictionary containing:
        - 'total_diagrams': Number of diagrams
        - 'references': List of reference tags
        - 'diagrams': Dictionary of all diagram data
        - 'formatted_diagrams': List of diagrams ready for response
    """
    accessor = await get_diagram_accessor()

    # Get raw diagram data
    session_summary = accessor.get_session_summary(session_id)

    # Get formatted diagrams for response
    formatted_diagrams = await accessor.get_formatted_diagrams(session_id)

    return {
        **session_summary,
        'formatted_diagrams': formatted_diagrams
    }