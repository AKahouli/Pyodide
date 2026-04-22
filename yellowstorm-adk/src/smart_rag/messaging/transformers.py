"""Message transformer for handling message transformation and tagging operations.

This module provides functionality for transforming raw message content by adding
task-specific tags and identifiers to track source attribution and task ordering
in multi-agent conversations.

Classes:
    MessageTransformer: Main class for message transformation and tagging operations.
"""

from typing import Tuple, List, Dict
import re2 as re
from src.logger.logging import get_logger

logger = get_logger("api.smart_rag.message_transformer")

class MessageTransformer:
    """Handles message transformation and tagging operations.

    This class provides static methods for processing and transforming messages
    for citation detection and buffering during streaming responses.
    """

    @staticmethod
    def simple_tag_transformer(tempmsg: str, task_n: int, buffer: str = "",
                               max_length: int = 2000, force_flush: bool = False) -> Tuple[str, str, List[str]]:
        """Buffer text chunks and detect complete citation references like [1], [2], [123].

        Buffers up to 5 characters after '[' to ensure complete citation patterns
        are detected even when streaming token-by-token splits them across chunks.

        Args:
            tempmsg: The message chunk to transform
            task_n: Task number (kept for compatibility, not used)
            buffer: Accumulated buffer from previous chunks
            max_length: Maximum message length before splitting
            force_flush: If True, flushes all content ignoring incomplete citations (stream end)

        Returns:
            Tuple of (text_to_send, new_buffer, detected_citations)
            - text_to_send: Text ready to send to client
            - new_buffer: Buffer for next chunk
            - detected_citations: List of complete citations found like ['[1]', '[2]']
        """
        MAX_CITATION_BUFFER = 5  # Max chars to buffer after '[' (covers [1] to [999])
        detected_citations = []

        # Combine buffer with new chunk
        combined = buffer + tempmsg

        # Force flush on stream end - detect all citations and return everything
        if force_flush:
            citation_pattern = r'\[(\d+)\]'
            matches = re.findall(citation_pattern, combined)
            detected_citations = [f"[{m}]" for m in matches]
            return combined, "", detected_citations

        # Check for potential incomplete citation in last 6 chars (5 + '[')
        search_window = combined[-(MAX_CITATION_BUFFER + 1):] if len(combined) >= (MAX_CITATION_BUFFER + 1) else combined

        if '[' in search_window:
            # Find position of last '['
            last_bracket_pos = combined.rfind('[')
            chars_after_bracket = len(combined) - last_bracket_pos
            potential_citation = combined[last_bracket_pos:]

            # If > 5 chars after '[', not a citation - send everything
            if chars_after_bracket > MAX_CITATION_BUFFER:
                citation_pattern = r'\[(\d+)\]'
                matches = re.findall(citation_pattern, combined)
                detected_citations = [f"[{m}]" for m in matches]
                return combined, "", detected_citations

            # Check if complete citation like [1], [12], [123]
            if re.match(r'\[\d+\]$', potential_citation):
                # Complete citation - detect and send all
                detected_citations = [potential_citation]
                return combined, "", detected_citations
            else:
                # Incomplete citation - buffer it
                text_to_send = combined[:last_bracket_pos]
                new_buffer = potential_citation

                # Detect any complete citations in the text we're sending
                if text_to_send:
                    citation_pattern = r'\[(\d+)\]'
                    matches = re.findall(citation_pattern, text_to_send)
                    detected_citations = [f"[{m}]" for m in matches]
                else:
                    detected_citations = []

                return text_to_send, new_buffer, detected_citations
        else:
            # No '[' in window - detect citations and send everything
            citation_pattern = r'\[(\d+)\]'
            matches = re.findall(citation_pattern, combined)
            detected_citations = [f"[{m}]" for m in matches]
            return combined, "", detected_citations
