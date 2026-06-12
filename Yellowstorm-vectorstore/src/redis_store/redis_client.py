"""Redis client initialization for BM25 indexing and search."""
from typing import Optional

from redis.asyncio import Redis
from redis.exceptions import ConnectionError

from src.config.settings import get_settings
from src.logger.logging import get_logger

logger = get_logger(__name__)
settings = get_settings()

# Global Redis client instance
_redis_client: Optional[Redis] = None


def get_redis_url() -> str:
    """Construct Redis URL from settings.

    This function builds the Redis URL based on SSL, authentication settings.
    Matches the pattern from the Yellowmind project.

    Returns:
        str: Redis URL (redis:// or rediss://)

    Examples:
        # SSL with auth
        "rediss://user:pass@host:port/db"
        # SSL without auth
        "rediss://host:port/db"
        # Non-SSL with auth
        "redis://user:pass@host:port/db"
        # Non-SSL without auth
        "redis://host:port/db"
    """
    if settings.ENABLE_REDIS_SSL:
        logger.info("Using SSL-enabled Redis connection")
        if settings.REDIS_USER and settings.REDIS_PASSWORD:
            logger.info("Using authenticated Redis connection with SSL")
            return f"rediss://{settings.REDIS_USER}:{settings.REDIS_PASSWORD}@{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB}"
        else:
            logger.info("Using non-authenticated Redis connection with SSL")
            return f"rediss://{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB}"
    else:
        logger.info("Using standard Redis connection")
        if settings.REDIS_USER and settings.REDIS_PASSWORD:
            logger.info("Using authenticated Redis connection")
            return f"redis://{settings.REDIS_USER}:{settings.REDIS_PASSWORD}@{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB}"
        else:
            logger.info("Using non-authenticated Redis connection")
            return f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}/{settings.REDIS_DB}"


async def get_redis_client() -> Redis:
    """Get or create Redis client instance.

    Uses get_redis_url() to build the connection URL, matching the
    pattern from the Yellowmind project.

    Returns:
        Redis: Async Redis client instance

    Raises:
        ConnectionError: If Redis connection fails
    """
    global _redis_client

    if _redis_client is None:
        try:
            redis_url = get_redis_url()

            _redis_client = Redis.from_url(
                redis_url,
                encoding="utf-8",
                decode_responses=True
            )

            # Test connection
            await _redis_client.ping()
            logger.info(f"✅ Redis client created: {settings.REDIS_HOST}:{settings.REDIS_PORT}")

        except ConnectionError as e:
            logger.error(f"❌ Failed to connect to Redis: {e}")
            raise

    return _redis_client


async def close_redis_client():
    """Close Redis client connection."""
    global _redis_client
    if _redis_client:
        await _redis_client.close()
        _redis_client = None
        logger.info("Redis client closed")
