import json
from typing import Optional
import redis.asyncio as aioredis
from src.logger.logging import get_logger
from src.schema.authentification_schema import UserInDB
from src.authentification.get_current_user import redis_manager

logger = get_logger(__name__)

async def get_redis_connection():
    """Get aioredis connection from shared pool"""
    return await redis_manager.get_redis_connection()

async def get_user(r: aioredis.Redis, username: str) -> Optional[UserInDB]:
    """
    Get user from redis using aioredis
    Args:
        r (aioredis.Redis): Redis connection
        username (str): Username
    Returns:
        Optional[UserInDB]: UserInDB or None
    """
    logger.info("Attempting to retrieve user from Redis")
    user_data = await r.get(username)
    if user_data is None:
        logger.info("User not found in Redis")
        return None
    try:
        user = json.loads(user_data)
        return UserInDB(**user)
    except json.JSONDecodeError:
        logger.error("Failed to decode user data from Redis")
        return None
    except Exception as e:
        logger.error(f"Failed to create UserInDB object: {e}")
        return None