"""Redis Store - BM25 Indexing for Yellowstorm Vectorstore.

This module provides BM25 index creation and management for Redis Stack.

The index is created during document upload in the worker.
Search functionality is later will be in Yellowstorm-adk repo (redis_bm25_search module).
"""
from .redis_client import get_redis_client, close_redis_client, get_redis_url
from .index import create_bm25_index, drop_bm25_index, get_index_info
from .status import DocumentStatus, DocumentStatusRedis
from .storage import store_chunks_in_redis, get_chunks_from_redis, delete_chunks_from_redis, count_chunks_in_redis

__all__ = [
    # Client
    "get_redis_client",
    "close_redis_client",
    "get_redis_url",
    # Index
    "create_bm25_index",
    "drop_bm25_index",
    "get_index_info",
    # Status
    "DocumentStatus",
    "DocumentStatusRedis",
    # Storage
    "store_chunks_in_redis",
    "get_chunks_from_redis",
    "delete_chunks_from_redis",
    "count_chunks_in_redis",
]
