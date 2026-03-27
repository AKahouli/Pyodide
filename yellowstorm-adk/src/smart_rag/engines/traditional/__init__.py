"""Traditional RAG processing engine.

This module contains the traditional RAG processing components:
- orchestrator: Main SmartRAGOrchestrator (formerly smart_rag_helper)
- event_processor: Event extraction and processing (formerly event_extractor)

This engine handles single-agent RAG interactions with document search and retrieval.
"""

from .orchestrator import SmartRAGOrchestrator
from .event_processor import EventExtractor

__all__ = [
    'SmartRAGOrchestrator',
    'EventExtractor'
]