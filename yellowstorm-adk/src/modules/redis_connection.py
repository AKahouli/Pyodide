"""Redis connection management for ADK search operations.

This module provides async Redis connection helpers for status-aware search.
"""
import redis.asyncio as aioredis

from src.config.settings import get_settings
from src.logger.logging import get_logger

logger = get_logger(__name__)

class SafeRedis:
    """Mock Redis client that doesn't crash if server is down."""
    async def get(self, *args, **kwargs): return None
    async def set(self, *args, **kwargs): return True
    async def delete(self, *args, **kwargs): return True
    async def ping(self, *args, **kwargs): return True
    async def hget(self, *args, **kwargs): return None
    async def hset(self, *args, **kwargs): return True
    async def exists(self, *args, **kwargs): return False
    async def close(self, *args, **kwargs): pass
    
    # Support for async context manager (async with r:)
    async def __aenter__(self): return self
    async def __aexit__(self, exc_type, exc_val, exc_tb): pass
    
    # Support for async iterables (async for key in r.scan_iter():)
    async def scan_iter(self, *args, **kwargs):
        if False: yield # Generator trick
        return

    def __getattr__(self, name):
        async def mock_method(*args, **kwargs):
            logger.warning(f"Redis unavailable: Mocking call to '{name}'")
            return None
        return mock_method


async def get_redis_connection(
    pool: bool = True,
    decode_responses: bool = True
) -> aioredis.Redis:
    """Get async Redis connection or SafeRedis mock if failed."""
    global _redis_pool

    settings = get_settings()
    redis_scheme = "rediss" if settings.ENABLE_REDIS_SSL else "redis"
    redis_url = f"{redis_scheme}://{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB}"

    if settings.REDIS_USER and settings.REDIS_PASSWORD:
        redis_url = f"{redis_scheme}://{settings.REDIS_USER}:{settings.REDIS_PASSWORD}@{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB}"

    if pool and _redis_pool is None:
        try:
            logger.info(f"Connecting to Redis: {settings.REDIS_HOST}:{settings.REDIS_PORT}")
            _redis_pool = aioredis.ConnectionPool.from_url(
                redis_url,
                decode_responses=decode_responses,
                socket_connect_timeout=1, # Very fast fail
                socket_timeout=2,
                max_connections=50,
            )
        except Exception as e:
            logger.warning(f"Redis initialization failed: {e}. Using SafeRedis dummy.")
            _redis_pool = None

    if pool:
        if _redis_pool is None:
            return SafeRedis()
        try:
            # Return real client
            return aioredis.Redis(connection_pool=_redis_pool)
        except Exception:
            return SafeRedis()
    else:
        try:
            return await aioredis.from_url(
                redis_url,
                decode_responses=decode_responses,
                socket_connect_timeout=1,
            )
        except Exception:
            return SafeRedis()


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
