"""
Session Citation Manager

Bridge between SearchToolkit instances and GlobalSessionManager.
Handles the conversion from tag-based to numeric citations.
"""

import asyncio
from copy import deepcopy
from typing import Dict, List, Optional, Any
from .global_session_manager import GlobalSessionManager
from src.logger.logging import get_logger

logger = get_logger("api.smart_rag.session.citation_manager")


class SessionCitationManager:
    """
    Bridge between SearchToolkit instances and GlobalSessionManager.
    Handles the conversion from tag-based to numeric citations.

    This manager ensures that:
    1. All SearchToolkit instances in a session share citation numbers
    2. Citations are sequential across the entire session [1], [2], [3]...
    3. Citation state persists across requests within the same session
    4. Tag-based references are converted to clean numeric citations
    """

    def __init__(self, session_id: str, db_pool=None):
        """
        Initialize the SessionCitationManager.

        Args:
            session_id: Unique identifier for the session
            db_pool: Optional database connection pool for persistence
        """
        self.session_id = session_id
        self.global_manager = GlobalSessionManager(session_id, db_pool)

        # Local cache for citations
        self.citation_cache = {}  # Maps tag to citation number
        self.lock = asyncio.Lock()

        logger.info(f"[SessionCitationManager] Initialized for session: {session_id}")

    @classmethod
    async def create(cls, session_id: str, db_pool=None):
        """
        Async factory: call this from async context to create the instance.
        """
        # If db_pool is not provided, fetch engine asynchronously
        if db_pool is None:
            db_pool = await cls._get_engine()
        self = cls.__new__(cls)
        # call the synchronous __init__ with the resolved db_pool
        cls.__init__(self, session_id, db_pool)
        return self

    @staticmethod
    async def _get_engine():
        """
        Async helper to retrieve DB engine.
        """
        from src.smart_rag.infrastructure.session.manager import get_shared_engine
        from src.config.settings import get_settings
        settings = get_settings()
        return await get_shared_engine(settings.DATABASE_URL)

    async def register_source(self, citation_tag: str, source_info: dict) -> int:
        """
        Register a source and get its numeric citation.

        Args:
            citation_tag: Unique tag identifying the source (e.g., "task_1_text_0")
            source_info: Dictionary containing source metadata

        Returns:
            int: The citation number assigned to this source
        """
        async with self.lock:
            # Check if we already have this citation
            if citation_tag in self.citation_cache:
                from src.root_runtime.evidence_capture import capture_citation
                number = self.citation_cache[citation_tag]
                capture_citation(citation_tag, number, getattr(self.global_manager, 'sources', {}).get(number, source_info))
                return self.citation_cache[citation_tag]

            # Register with the global manager
            number = await self.global_manager.add_citation(citation_tag, source_info)
            self.citation_cache[citation_tag] = number
            from src.root_runtime.evidence_capture import capture_citation
            capture_citation(citation_tag, number, getattr(self.global_manager, 'sources', {}).get(number, source_info))

            logger.debug(f"[SessionCitationManager] Registered citation: {citation_tag} -> [{number}]")
            return number

    async def cite_text_source(self, source_object: dict, page: int = None) -> str:
        """
        Cite a text source from SearchToolkit using the source object as identifier.

        Args:
            source_object: The text source object containing content and metadata
            page: Optional page number for the source

        Returns:
            str: Citation string in format [n]
        """
        import hashlib

        # Create a unique hash from the source object content to use as citation tag
        source_content = str(source_object.get('content', {}))
        citation_tag = f"text_{hashlib.md5(source_content.encode()).hexdigest()[:12]}"

        source_info = {
            "type": "text",
            "source_object": source_object,
            "page": page
        }

        number = await self.register_source(citation_tag, source_info)
        return f"[{number}]"

    async def cite_image_source(self, task_order: int, image_path: str) -> str:
        """
        Cite an image source from SearchToolkit.

        Args:
            task_order: The task order number from SearchToolkit
            image_path: Path or filename of the image

        Returns:
            str: Citation string in format [n]
        """
        # Extract filename from path if needed
        filename = image_path.split('/')[-1] if '/' in image_path else image_path
        citation_tag = f"task_{task_order}_image_{filename}"

        source_info = {
            "type": "image",
            "path": image_path,
            "filename": filename,
            "task_order": task_order
        }

        number = await self.register_source(citation_tag, source_info)
        return f"[{number}]"

    async def get_cited_sources(self) -> List[dict]:
        """
        Get all cited sources from the session.

        Returns:
            List[dict]: List of sources with their numeric citations in order
        """
        sources = self.global_manager.get_all_sources()
        cited_list = []

        for number in sorted(sources.keys()):
            source_info = sources[number]
            cited_list.append({
                "number": number,
                "reference": f"[{number}]",
                **source_info
            })

        logger.debug(f"[SessionCitationManager] Retrieved {len(cited_list)} cited sources")
        return cited_list

    async def process_search_results(self, sources: List[dict],
                                   task_order: int, source_type: str = "text"):
        """
        Process and register search results from SearchToolkit.

        This method can be called after a search to pre-register all sources.

        Args:
            sources: List of sources from SearchToolkit
            task_order: The task order from SearchToolkit
            source_type: Type of sources ("text" or "image")
        """
        for i, source in enumerate(sources):
            if source_type == "text":
                citation_tag = f"task_{task_order}_text_{i}"
                source_info = {
                    "type": "text",
                    "content": source.get("page_content", ""),
                    "metadata": source.get("metadata", {}),
                    "index": i,
                    "task_order": task_order
                }
            elif source_type == "image":
                # Extract image path from source
                image_path = source.get("image_path", f"image_{i}")
                if "object" in source and "metadata" in source["object"]:
                    image_path = source["object"]["metadata"].get("image_path", image_path)

                citation_tag = f"task_{task_order}_image_{image_path}"
                source_info = {
                    "type": "image",
                    "path": image_path,
                    "metadata": source.get("object", {}).get("metadata", {}),
                    "index": i,
                    "task_order": task_order
                }
            else:
                logger.warning(f"[SessionCitationManager] Unknown source type: {source_type}")
                continue

            await self.register_source(citation_tag, source_info)

        logger.info(f"[SessionCitationManager] Processed {len(sources)} {source_type} sources from task {task_order}")

    def get_session_stats(self) -> dict:
        """
        Get statistics about the current session.

        Returns:
            dict: Session statistics including citation counts
        """
        stats = self.global_manager.get_session_stats()
        stats["local_cache_size"] = len(self.citation_cache)
        return stats

    async def reset_session(self):
        """
        Reset all citations for the session (for testing/debug).
        """
        await self.global_manager.reset_citations()
        self.citation_cache.clear()
        logger.info(f"[SessionCitationManager] Reset session {self.session_id}")


class CitationManagerRegistry:
    """
    Global registry for caching SessionCitationManager instances.

    Ensures that the same SessionCitationManager is reused for the same session_id
    across multiple requests, maintaining citation continuity.
    """

    def __init__(self):
        self._managers: Dict[str, SessionCitationManager] = {}
        self._locks: Dict[str, asyncio.Lock] = {}
        self._registry_lock = asyncio.Lock()

    async def get_or_create_manager(self, session_id: str, db_pool=None) -> SessionCitationManager:
        """
        Get an existing SessionCitationManager for the session_id or create a new one.

        Args:
            session_id: Unique identifier for the session
            db_pool: Optional database connection pool

        Returns:
            SessionCitationManager: Cached or newly created instance
        """
        async with self._registry_lock:
            # Return existing manager if already cached
            if session_id in self._managers:
                logger.debug(f"[CitationRegistry] Reusing existing citation manager for session: {session_id}")
                return self._managers[session_id]

            # Create a new manager if it doesn't exist
            logger.info(f"[CitationRegistry] Creating new citation manager for session: {session_id}")

            # Create a lock for this specific session if not exists
            if session_id not in self._locks:
                self._locks[session_id] = asyncio.Lock()

            # Create new manager instance
            manager = await SessionCitationManager.create(session_id, db_pool)

            # Cache the manager
            self._managers[session_id] = manager

            return manager

    async def remove_manager(self, session_id: str):
        """
        Remove a citation manager from the registry.

        Args:
            session_id: Session identifier to remove
        """
        async with self._registry_lock:
            if session_id in self._managers:
                del self._managers[session_id]
                logger.info(f"[CitationRegistry] Removed citation manager for session: {session_id}")

            if session_id in self._locks:
                del self._locks[session_id]

    async def clear_all(self):
        """
        Clear all cached managers. Useful for testing or cleanup.
        """
        async with self._registry_lock:
            self._managers.clear()
            self._locks.clear()
            logger.info("[CitationRegistry] Cleared all cached citation managers")

    def get_session_stats(self) -> Dict:
        """
        Get statistics about cached sessions.

        Returns:
            Dict: Statistics about cached citation managers
        """
        return {
            "cached_sessions": len(self._managers),
            "session_ids": list(self._managers.keys())
        }


# Global instance
_citation_registry = CitationManagerRegistry()


async def get_citation_manager(session_id: str, db_pool=None) -> SessionCitationManager:
    """
    Global function to get or create a SessionCitationManager.

    This is the preferred way to get a citation manager instance as it ensures
    proper caching and reuse across requests.

    Args:
        session_id: Unique identifier for the session
        db_pool: Optional database connection pool

    Returns:
        SessionCitationManager: Cached or newly created instance
    """
    return await _citation_registry.get_or_create_manager(session_id, db_pool)


async def remove_citation_manager(session_id: str):
    """
    Remove a citation manager from the global registry.

    Args:
        session_id: Session identifier to remove
    """
    await _citation_registry.remove_manager(session_id)


async def clone_citation_manager_state(
    source_session_id: str,
    target_session_id: str,
    db_pool=None,
) -> SessionCitationManager:
    """
    Clone citation state from one session into another session.

    This is used when a playbook step creates a derived session that must keep
    the original citation numbering and continue appending from it.
    """
    if not source_session_id or not source_session_id.strip():
        raise ValueError("source_session_id cannot be empty")
    if not target_session_id or not target_session_id.strip():
        raise ValueError("target_session_id cannot be empty")

    if source_session_id == target_session_id:
        return await get_citation_manager(source_session_id, db_pool)

    source_manager = await get_citation_manager(source_session_id, db_pool)
    target_manager = await SessionCitationManager.create(target_session_id, db_pool)

    async with source_manager.lock:
        target_manager.citation_cache = deepcopy(source_manager.citation_cache)
        target_manager.global_manager.next_task_order = source_manager.global_manager.next_task_order
        target_manager.global_manager.next_citation_number = source_manager.global_manager.next_citation_number
        target_manager.global_manager.citation_mapping = deepcopy(
            source_manager.global_manager.citation_mapping
        )
        target_manager.global_manager.sources = deepcopy(source_manager.global_manager.sources)
        await target_manager.global_manager._save_state()

    async with _citation_registry._registry_lock:
        _citation_registry._managers[target_session_id] = target_manager
        if target_session_id not in _citation_registry._locks:
            _citation_registry._locks[target_session_id] = asyncio.Lock()

    logger.info(
        "[CitationRegistry] Cloned citation state from session %s to %s",
        source_session_id,
        target_session_id,
    )
    return target_manager


async def clear_all_citation_managers():
    """
    Clear all cached citation managers. Useful for testing.
    """
    await _citation_registry.clear_all()


def get_citation_registry_stats() -> Dict:
    """
    Get statistics about the global citation registry.

    Returns:
        Dict: Statistics about cached citation managers
    """
    return _citation_registry.get_session_stats()
