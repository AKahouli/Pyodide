"""
Global Session Manager for Citation and Task Order Tracking

This module provides a centralized manager for handling:
- Session-wide task order numbering
- Citation numbering that persists across requests
- Simplified [1], [2] citation format
- In-memory caching of session state (no database dependency)
"""

import json
from typing import Dict, Optional, Any, List
from datetime import datetime, timedelta
from src.logger.logging import get_logger

logger = get_logger("api.smart_rag.session.global_session_manager")

# Global in-memory cache for all sessions
_session_cache = {}
_cache_timestamps = {}
_cache_timeout_hours = 24  # Cache expires after 24 hours


class GlobalSessionManager:
    """
    Centralized session manager that handles task order and citation tracking.

    This manager ensures that:
    1. All agents in a session get sequential task order numbers
    2. Citation numbers are sequential across the entire session [1], [2], [3]...
    3. Citation state persists across requests within the same session
    4. Complex citation tags are eliminated in favor of simple numbering
    """

    def __init__(self, session_id: str, db_pool=None):
        """
        Initialize the GlobalSessionManager.
        Args:
            session_id: Unique identifier for the session
            db_pool: Optional database connection pool for persistence (ignored in cache mode)
        """
        self.session_id = session_id
        self.db_pool = None  # Ignored in cache mode

        # Task order tracking
        self.next_task_order = 1

        # Citation tracking
        self.next_citation_number = 1
        self.citation_mapping = {}  # citation_tag -> number
        self.sources = {}  # number -> source_info

    @classmethod
    async def create(cls, session_id: str, db_pool=None):
        """
        Async factory method to create and initialize GlobalSessionManager.

        Args:
            session_id: Unique identifier for the session
            db_pool: Optional database connection pool for persistence (ignored in cache mode)

        Returns:
            GlobalSessionManager: Fully initialized manager with state loaded from cache
        """
        self = cls(session_id, db_pool)
        await self._load_state()
        return self

    async def _load_state(self):
        """Load citation state from in-memory cache"""
        try:
            # Check if session exists in cache
            if self.session_id in _session_cache:
                cached_data = _session_cache[self.session_id]
                self.next_citation_number = cached_data.get('next_citation_number', 1)
                self.citation_mapping = cached_data.get('citation_mapping', {})
                self.sources = cached_data.get('sources', {})

                # Update timestamp to extend cache life
                _cache_timestamps[self.session_id] = datetime.now()

                logger.info(f"[GlobalSessionManager] Loaded state from cache for session {self.session_id}: "
                          f"next_citation={self.next_citation_number}, "
                          f"citations={len(self.citation_mapping)}")
            else:
                logger.info(f"[GlobalSessionManager] No existing cache found for session {self.session_id}")

        except Exception as e:
            logger.error(f"[GlobalSessionManager] Error loading state from cache for session {self.session_id}: {e}")
            # Initialize with default values if loading fails
            self.next_citation_number = 1
            self.citation_mapping = {}
            self.sources = {}

    def _cleanup_expired_cache(self):
        """Remove expired sessions from cache"""
        current_time = datetime.now()
        expired_sessions = []

        for session_id, timestamp in _cache_timestamps.items():
            if current_time - timestamp > timedelta(hours=_cache_timeout_hours):
                expired_sessions.append(session_id)

        for session_id in expired_sessions:
            _session_cache.pop(session_id, None)
            _cache_timestamps.pop(session_id, None)
            logger.debug(f"[GlobalSessionManager] Cleaned up expired cache for session {session_id}")

    async def _save_state(self):
        """Save citation state to in-memory cache"""
        try:
            # Clean up expired entries first
            self._cleanup_expired_cache()

            # Save current session state
            _session_cache[self.session_id] = {
                'next_citation_number': self.next_citation_number,
                'citation_mapping': dict(self.citation_mapping),
                'sources': dict(self.sources)
            }
            _cache_timestamps[self.session_id] = datetime.now()

            logger.debug(f"[GlobalSessionManager] Saved state to cache for session {self.session_id}: "
                       f"next_citation={self.next_citation_number}, "
                       f"citations={len(self.citation_mapping)}")

        except Exception as e:
            logger.error(f"[GlobalSessionManager] Error saving state to cache for session {self.session_id}: {e}")

    def get_next_task_order(self) -> int:
        """
        Get the next task order number and increment.

        Returns:
            int: The next task order number for this session
        """
        order = self.next_task_order
        self.next_task_order += 1
        logger.debug(f"[GlobalSessionManager] Assigned task order {order} to agent")
        return order

    async def add_citation(self, citation_tag: str, source_info: dict) -> int:
        """
        Add a citation and return its assigned number (session-wide sequential).

        Args:
            citation_tag: Unique identifier for the citation (e.g., "task_1_text_0")
            source_info: Dictionary containing source metadata

        Returns:
            int: The citation number for this source
        """
        if citation_tag not in self.citation_mapping:
            number = self.next_citation_number
            self.citation_mapping[citation_tag] = number
            self.sources[number] = source_info
            self.next_citation_number += 1

            # Save to cache after each addition
            await self._save_state()

            logger.debug(f"[GlobalSessionManager] Added citation {number} for tag '{citation_tag}'")

        return self.citation_mapping[citation_tag]

    def get_citation_number(self, citation_tag: str) -> Optional[int]:
        """
        Get existing citation number for a tag.

        Args:
            citation_tag: The citation tag to look up

        Returns:
            Optional[int]: The citation number if exists, None otherwise
        """
        return self.citation_mapping.get(citation_tag)

    def get_all_sources(self) -> Dict[int, dict]:
        """
        Get all sources with their citation numbers in order.

        Returns:
            Dict[int, dict]: Mapping of citation numbers to source info
        """
        return dict(sorted(self.sources.items()))

    def get_cited_sources_summary(self) -> List[dict]:
        """
        Get a summary of all cited sources for display.

        Returns:
            List[dict]: List of sources with their citation numbers
        """
        sources = self.get_all_sources()
        return [{"number": num, **info} for num, info in sources.items()]

    async def reset_citations(self):
        """
        Reset all citations for the session (testing/debug).
        """
        self.next_citation_number = 1
        self.citation_mapping = {}
        self.sources = {}
        await self._save_state()
        logger.info(f"[GlobalSessionManager] Reset all citations for session {self.session_id}")

    def get_session_stats(self) -> dict:
        """
        Get statistics about the current session.

        Returns:
            dict: Session statistics
        """
        return {
            "session_id": self.session_id,
            "next_task_order": self.next_task_order,
            "next_citation_number": self.next_citation_number,
            "total_citations": len(self.citation_mapping),
            "total_sources": len(self.sources)
        }

    async def clear_session_from_cache(self):
        """
        Manually clear this session from the in-memory cache.
        Useful for cleanup when a session ends or for testing.
        """
        try:
            _session_cache.pop(self.session_id, None)
            _cache_timestamps.pop(self.session_id, None)
            logger.info(f"[GlobalSessionManager] Cleared session {self.session_id} from cache")
        except Exception as e:
            logger.error(f"[GlobalSessionManager] Error clearing session {self.session_id} from cache: {e}")

    @classmethod
    def get_cache_stats(cls) -> dict:
        """
        Get statistics about the global cache.

        Returns:
            dict: Cache statistics
        """
        current_time = datetime.now()
        active_sessions = 0

        for session_id, timestamp in _cache_timestamps.items():
            if current_time - timestamp <= timedelta(hours=_cache_timeout_hours):
                active_sessions += 1

        return {
            "total_cached_sessions": len(_session_cache),
            "active_sessions": active_sessions,
            "cache_timeout_hours": _cache_timeout_hours
        }