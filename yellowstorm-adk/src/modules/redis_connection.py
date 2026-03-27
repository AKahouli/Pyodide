"""Redis connection management for ADK search operations.

This module provides async Redis connection helpers for status-aware search.
"""
import redis.asyncio as aioredis

from src.config.settings import get_settings
from src.logger.logging import get_logger

logger = get_logger(__name__)

# Connection pool cache (singleton pattern)
_redis_pool: aioredis.ConnectionPool = None


async def get_redis_connection(
    pool: bool = True,
    decode_responses: bool = True
) -> aioredis.Redis:
    """Get async Redis connection for search operations.

    Reuses existing Redis configuration from settings.
    Uses connection pooling by default for better performance.

    Args:
        pool: Whether to use connection pooling (default: True)
        decode_responses: Whether to decode responses to strings (default: True)

    Returns:
        Async Redis client instance

    Example:
           r = await get_redis_connection()
           await r.ping()
        True
    """
    global _redis_pool

    settings = get_settings()

    # Build Redis URL (use rediss:// scheme for SSL connections)
    redis_scheme = "rediss" if settings.ENABLE_REDIS_SSL else "redis"
    redis_url = f"{redis_scheme}://{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB}"

    # Add authentication if configured
    if settings.REDIS_USER and settings.REDIS_PASSWORD:
        redis_url = f"{redis_scheme}://{settings.REDIS_USER}:{settings.REDIS_PASSWORD}@{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB}"

    if pool and _redis_pool is None:
        # Create connection pool (singleton)
        logger.info(f"Creating Redis connection pool: {settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB} (SSL={settings.ENABLE_REDIS_SSL})")
        _redis_pool = aioredis.ConnectionPool.from_url(
            redis_url,
            decode_responses=decode_responses,
            socket_connect_timeout=2, # to make connection
            socket_timeout=5, # wait for a response before timeout
            max_connections=50,  # Reasonable pool size
        )

    if pool:
        return aioredis.Redis(connection_pool=_redis_pool)
    else:
        # Create standalone connection
        logger.debug(f"Creating standalone Redis connection: {settings.REDIS_HOST}:{settings.REDIS_PORT}")
        return await aioredis.from_url(
            redis_url,
            decode_responses=decode_responses,
            socket_connect_timeout=2,
            socket_timeout=5,
        )


async def close_redis_pool():
    """Close the Redis connection pool.

    Should be called on application shutdown to clean up resources.
    """
    global _redis_pool
    if _redis_pool is not None:
        await _redis_pool.aclose()
        _redis_pool = None
        logger.info("Redis connection pool closed")


def get_redis_url() -> str:
    """Get the Redis connection URL.

    Returns:
        Redis URL string (without password for logging purposes)

    Example:
        url = get_redis_url()
        print(url)
        'redis://localhost:6379/0'
    """
    settings = get_settings()
    return f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB}"
