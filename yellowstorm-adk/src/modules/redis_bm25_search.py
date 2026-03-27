"""Redis BM25 full-text search module for ADK.

This module provides async functions for BM25 search on Redis RediSearch
Used for PENDING and FAILED documents in status-aware search routing.

The BM25 index 'idx:chunks' is created by vectorstores
during document upload. This module only queries the existing index

"""
import json
import time

import re2 as re

from typing import Any, Dict, List, Optional, Tuple
import redis.asyncio as aioredis

from src.logger.logging import get_logger

logger = get_logger(__name__)

# Redis configuration
INDEX_NAME = "idx:chunks"
KEY_PREFIX = "chunk:"

# Cache for index check - avoid FT.INFO call on every search request
_index_verified = False


def _normalize_text_query(query: str) -> str:
    """Normalize query for BM25: lower-case, strip punctuation/quotes, collapse spaces

    Args:
        query: Raw search query

    Returns:
        Normalized query string
    """
    if not query:
        return ""
    normalized = query.lower()
    # Remove quotes and apostrophes
    normalized = re.sub(r"['`""'']" , " ", normalized)
    # Remove punctuation, keep only alphanumeric and spaces
    normalized = re.sub(r"[^\w\s]", " ", normalized)
    # Collapse multiple spaces
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _escape_text_query(query: str) -> str:
    """Escape RediSearch special characters in the query

    RediSearch special characters that need escaping:
    - - \ [ ] { } ( ) | : ! @ ~ ^ " '

    Args:
        query: Query string to escape

    Returns:
        Escaped query string
    """
    if not query:
        return ""
    # Escape special RediSearch characters
    return re.sub(r'([\-\\\[\]\{\}\(\)\|\:\!\@\~\^\\"\'])', r'\\\1', query)


def _escape_tag_value(value: str) -> str:
    """Escape special characters in TAG values.

    TAG filters have different escaping rules than TEXT fields.
    Special chars for TAG: \ { } | : -

    Args:
        value: Tag value to escape

    Returns:
        Escaped tag value
    """
    if not value:
        return ""
    return re.sub(r'([\\\{\}\|\:\\-])', r'\\\1', value)


async def verify_index(r: aioredis.Redis) -> None:
    """Verify that the RediSearch index exists

    Raises RuntimeError if the index does not exist. The index should be
    created by vectorstores during document upload

    Uses in-memory caching to avoid redundant FT.INFO calls on subsequent
    invocations

    Args:
        r: Async Redis client instance

    Raises:
        RuntimeError: If the index does not exist in Redis
    """
    global _index_verified

    # Skip Redis call if index was already verified
    if _index_verified:
        logger.debug(f"Index '{INDEX_NAME}' already verified (cached)")
        return

    try:
        await r.execute_command("FT.INFO", INDEX_NAME)
        logger.debug(f"Index '{INDEX_NAME}' verified")
        _index_verified = True
    except aioredis.ResponseError:
        raise RuntimeError(
            f"RediSearch index '{INDEX_NAME}' does not exist. "
            f"index should be created by vectorstores during document upload."
        )


async def search_bm25(
    r: aioredis.Redis,
    query: str,
    brain_id: Optional[str] = None,
    external_ids: Optional[List[str]] = None,
    k: int = 10,
) -> List[Tuple[float, Dict[str, Any]]]:
    """Async BM25 search using FT.SEARCH.

    Returns list of (score, doc_fields).

    Features:
    - BM25 full-text search on document content
    - Tag filtering by brain_id and external_ids
    - OR fallback: multi-word queries try AND logic first, then OR if no results

    Args:
        r: Async Redis client instance
        query: Full-text search query
        brain_id: Optional brain_id filter (TAG)
        external_ids: Optional list of external_ids to filter (TAG) - searches only these documents
        k: Maximum number of results to return

    Returns:
        List of tuples (score, document_fields) where document_fields contains:
        - page_content: Text content of the chunk
        - brain_id: Document brain ID
        - external_id: Document external ID
        - source: Document source file
        - page: Page number
        - chunk_order: Order of chunk in document

    Examples:
        # Search by brain_id only
        results = await search_bm25(r, "machine learning", brain_id="brain_123", k=5)

        # Search by brain_id and multiple external_ids
        results = await search_bm25(r, "machine learning", brain_id="brain_123",
                                   external_ids=["doc_a", "doc_b"], k=5)
    """
    start_time = time.time()
    await verify_index(r)

    # Build query with optional TAG filters
    q_parts = []

    # Add brain_id filter if provided
    if brain_id:
        q_parts.append(f"@brain_id:{{{_escape_tag_value(brain_id)}}}")

    # Handle external_ids filtering
    if external_ids:
        # Filter by multiple external_ids using TAG union syntax
        # Redis TAG query: @external_id:{id1}|{id2}|{id3}
        external_filter = "|".join(_escape_tag_value(x) for x in external_ids)
        q_parts.append(f"@external_id:{{{external_filter}}}")
        logger.debug(f"Filtering by external_ids: {external_ids}")

    # Normalize and escape the search query
    normalized_query = _normalize_text_query(query)
    escaped_search = _escape_text_query(normalized_query if normalized_query else query)
    tokens = normalized_query.split() if normalized_query else []

    logger.info(
        "BM25 search prepared | field=content | raw_query=%s | normalized_query=%s | tokens=%s | escaped=%s",
        query,
        normalized_query,
        tokens,
        escaped_search,
    )

    # Add content search to query
    #for multi-word queries, use term-based AND instead of phrase search for better matching
    if len(tokens) > 1:
        # Split into individual terms with AND between them
        escaped_tokens = [_escape_text_query(t) for t in tokens]
        term_query = " ".join([f"@content:({t})" for t in escaped_tokens])
        q_parts.append(term_query)
        logger.debug(f"Multi-word query: using term-based AND: {term_query}")
    else:
        # Single word - use phrase search
        q_parts.append(f"@content:({escaped_search})")

    final_query = " ".join(q_parts)

    logger.debug(f"Executing BM25 search: query='{final_query}', k={k}")

    try:
        raw = await r.execute_command(
            "FT.SEARCH",
            INDEX_NAME,
            final_query,
            "WITHSCORES",
            "RETURN",
            "4",
            "$.page_content",
            "$.metadata.brain_id",
            "$.metadata.external_id",
            "$.metadata.source",
            "LIMIT",
            "0",
            str(k),
        )
    except aioredis.ResponseError as e:
        logger.error(f"Redis search failed for query '{query}': {e}")
        raise

    # Check if we got results
    result_count = int(raw[0]) if raw and len(raw) > 0 else 0

    # Fallback 1: if single-word query returned 0, try wildcard search
    # This handles cases where special chars are attached to indexed tokens (e.g., "»Michael")
    if result_count == 0 and len(tokens) == 1 and tokens[0]:
        logger.info(f"BM25 single-word query returned 0 results - trying wildcard fallback for '{tokens[0]}'")

        # Try wildcard: *term
        wildcard_query = f"*{tokens[0]}"
        escaped_wildcard = _escape_text_query(wildcard_query)

        # Replace the old content query with wildcard query
        q_parts.pop()  # Remove old @content:() part
        q_parts.append(f"@content:({escaped_wildcard})")
        final_query_wildcard = " ".join(q_parts)

        logger.info(f"BM25 wildcard fallback | query: {wildcard_query}")
        try:
            raw_wildcard = await r.execute_command(
                "FT.SEARCH",
                INDEX_NAME,
                final_query_wildcard,
                "WITHSCORES",
                "RETURN",
                "4",
                "$.page_content",
                "$.metadata.brain_id",
                "$.metadata.external_id",
                "$.metadata.source",
                "LIMIT",
                "0",
                str(k),
            )
            result_count = int(raw_wildcard[0]) if raw_wildcard and len(raw_wildcard) > 0 else 0
            if result_count > 0:
                logger.info(f"BM25 wildcard fallback succeeded with {result_count} results")
                raw = raw_wildcard
        except aioredis.ResponseError as e:
            logger.warning(f"BM25 wildcard fallback also failed: {e}")
            # Return original empty result

    # Fallback 2: If AND logic returned 0 and we have multiple tokens, try OR logic
    if result_count == 0 and len(tokens) > 1:
        logger.info(f"BM25 AND logic returned 0 results for {len(tokens)} tokens - trying OR logic fallback")

        # Build OR query: escape each token individually, then join with |
        # Don't escape the | itself as it's the OR operator
        escaped_tokens = [_escape_text_query(t) for t in tokens]
        escaped_or_query = "|".join(escaped_tokens)

        # Remove the old content query and add OR query
        q_parts.pop()  # Remove old @content:() part
        q_parts.append(f"@content:({escaped_or_query})")
        final_query_or = " ".join(q_parts)

        logger.info(f"BM25 fallback | OR query: {escaped_or_query}")
        try:
            raw_or = await r.execute_command(
                "FT.SEARCH",
                INDEX_NAME,
                final_query_or,
                "WITHSCORES",
                "RETURN",
                "4", # number of returned fileds
                "$.page_content",
                "$.metadata.brain_id",
                "$.metadata.external_id",
                "$.metadata.source",
                "LIMIT",
                "0",
                str(k),
            )
            result_count = int(raw_or[0]) if raw_or and len(raw_or) > 0 else 0
            if result_count > 0:
                logger.info(f"BM25 OR fallback succeeded with {result_count} results")
                raw = raw_or
        except aioredis.ResponseError as e:
            logger.warning(f"BM25 OR fallback also failed: {e}")
            # Return original empty result

    # Raw format: [total, key1, score1, [field, value, field, value...], key2, score2, [...], ...]
    results = []
    if not raw or len(raw) < 2:
        duration = time.time() - start_time
        logger.debug(f"BM25 search returned no results in {duration:.3f}s")
        return results

    for i in range(1, len(raw), 3):
        key = raw[i]
        score = float(raw[i + 1])
        fields = raw[i + 2]  # flat list: [fieldname, value, fieldname, value...]

        # Extract document fields from RETURN values
        doc = {}
        for j in range(0, len(fields), 2):
            fname = fields[j]
            fval = fields[j + 1]
            if fname == "$.page_content":
                doc["page_content"] = fval
            elif fname == "$.metadata.brain_id":
                doc["brain_id"] = fval
            elif fname == "$.metadata.external_id":
                doc["external_id"] = fval
            elif fname == "$.metadata.source":
                doc["source"] = fval

        # If we didn't get content from RETURN, fetch the full document with JSON.GET
        if not doc.get("page_content"):
            try:
                # Try JSON.GET for RedisJSON objects
                full_doc = await r.execute_command("JSON.GET", key)
                if full_doc:
                    chunk_data = json.loads(full_doc)
                    doc["page_content"] = chunk_data.get("page_content", "")
                    doc["brain_id"] = chunk_data.get("metadata", {}).get("brain_id", "")
                    doc["external_id"] = chunk_data.get("metadata", {}).get("external_id", "")
                    doc["source"] = chunk_data.get("metadata", {}).get("source", "")
                    doc["page"] = chunk_data.get("metadata", {}).get("page", "")
                    doc["chunk_order"] = chunk_data.get("metadata", {}).get("chunk_order", "")
            except Exception as e:
                logger.debug(f"Failed to fetch full doc with JSON.GET for {key}: {e}")

        results.append((score, doc))

    duration = time.time() - start_time
    logger.info(f"BM25 search returned {len(results)} results in {duration:.3f}s")
    return results


async def get_index_info(r: aioredis.Redis) -> Dict[str, Any]:
    """Get detailed information about the RediSearch index.

    Args:
        r: Async Redis client instance

    Returns:
        Dictionary with index information including:
        - num_docs: Number of indexed documents
        - indexing: Indexing status (0 = done, 1 = in progress)
        - schema: Field definitions
        - attributes: Index attributes
    """
    try:
        info = await r.execute_command("FT.INFO", INDEX_NAME)
        result = {}
        for i in range(0, len(info), 2):
            key = info[i]
            val = info[i + 1]
            result[key] = val
        return result
    except aioredis.ResponseError as e:
        logger.error(f"Failed to get index info: {e}")
        return {}


async def health_check(r: aioredis.Redis) -> bool:
    """Check if Redis and the search index are healthy.

    Args:
        r: Async Redis client instance

    Returns:
        True if healthy (Redis reachable and index exists), False otherwise
    """
    try:
        # Check Redis connection
        await r.ping()
        # Check if index exists
        await r.execute_command("FT.INFO", INDEX_NAME)
        return True
    except (aioredis.ConnectionError, aioredis.ResponseError) as e:
        logger.warning(f"Redis health check failed: {e}")
        return False