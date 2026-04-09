from typing import Annotated, Optional
import redis.asyncio as aioredis
import json
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
import jwt
from jwt import PyJWTError
from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.schema.authentification_schema import TokenData, User, UserInDB


logger = get_logger(__name__)
app_settings = get_settings()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token", auto_error=False)

class RedisConnectionManager:
    _instance: Optional['RedisConnectionManager'] = None
    _redis_pool: Optional[aioredis.ConnectionPool] = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    async def get_connection_pool(self) -> aioredis.ConnectionPool:
        if self._redis_pool is None:
            try:
                if app_settings.ENABLE_REDIS_SSL:
                    logger.info(f"Creating Redis SSL connection pool to {app_settings.REDIS_HOST}:{app_settings.REDIS_PORT}")
                    connection_url = f"rediss://{app_settings.REDIS_USER}:{app_settings.REDIS_PASSWORD}@{app_settings.REDIS_HOST}:{app_settings.REDIS_PORT}/{app_settings.REDIS_DB}"
                else:
                    logger.info(f"Creating Redis connection pool to {app_settings.REDIS_HOST}:{app_settings.REDIS_PORT}")
                    connection_url = f"redis://{app_settings.REDIS_USER}:{app_settings.REDIS_PASSWORD}@{app_settings.REDIS_HOST}:{app_settings.REDIS_PORT}/{app_settings.REDIS_DB}"
                
                self._redis_pool = aioredis.ConnectionPool.from_url(
                    connection_url,
                    max_connections=20,
                    retry_on_timeout=True,
                    socket_connect_timeout=2  # Don't wait forever if redis is down
                )
                logger.info("Redis connection pool created successfully")
            except Exception as e:
                logger.error(f"Failed to create Redis connection pool: {e}. Authentication will be degraded.")
                self._redis_pool = None
                raise
        return self._redis_pool
    
    async def get_redis_connection(self) -> aioredis.Redis:
        pool = await self.get_connection_pool()
        return aioredis.Redis(connection_pool=pool)
    
    async def close_pool(self):
        if self._redis_pool:
            await self._redis_pool.disconnect()
            self._redis_pool = None
            logger.info("Redis connection pool closed")

redis_manager = RedisConnectionManager()

async def get_redis_connection():
    return await redis_manager.get_redis_connection()

async def get_user(r: aioredis.Redis, username: str):
    """Get user from Redis using aioredis"""
    try:
        logger.info("Attempting to retrieve user from Redis")
        user_data = await r.get(username)
        if user_data is None:
            logger.info("User not found in Redis")
            return None
        user = json.loads(user_data)
        logger.info("User successfully retrieved and parsed from Redis")
        return UserInDB(**user)
    except Exception as e:
        logger.error(f"Redis error in get_user: {e}")
        return None

async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]):
    logger.info("Starting user authentication process")
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        logger.info("Decoding JWT token")
        payload = jwt.decode(
            token, 
            app_settings.SECRET_KEY, 
            algorithms=[app_settings.ALGORITHM],
            options={"verify_aud": False}
        )
        logger.info("JWT token decoded successfully, extracting username")
        username: str = payload.get("sub")  # type: ignore
        if username is None:
            logger.info("Username not found in token payload")
            raise credentials_exception
        token_data = TokenData(username=username)
        logger.info("Token data created successfully")
    except PyJWTError as e:
        logger.exception(f"JWT token validation failed: {e}")
        raise credentials_exception
    
    logger.info("Retrieving user from Redis using connection pool")
    try:
        r = await get_redis_connection()
        user = await get_user(r, username=token_data.username)  # type: ignore
        if user is None:
            logger.info("User not found in Redis, falling back to anonymous user structure if possible")
            # If user is not in Redis, we could potentially return a basic User object or fail
            raise credentials_exception
        logger.info("User authentication completed successfully")
        return user
    except Exception as e:
        logger.warning(f"Authentication database (Redis) unavailable: {e}. Failing gracefully to allow system core to function.")
        # If redis fails we can return an emergency user or just re-raise credentials exception
        # We'll re-raise to ensure security, but the get_current_user_optional will handle it.
        raise credentials_exception

async def get_current_active_user(current_user: Annotated[User, Depends(get_current_user)]):
    logger.info("Checking user active status")
    if current_user.disabled:
        logger.info("User account is disabled")
        raise HTTPException(status_code=400, detail="Inactive user")
    logger.info("User is active, authentication process completed")
    return current_user

async def get_current_user_optional(token: Annotated[Optional[str], Depends(oauth2_scheme)] = None):
    if not token:
        logger.info("No token provided, returning anonymous user")
        return User(username="anonymous", disabled=False)
    try:
        return await get_current_user(token)
    except Exception as e:
        logger.info(f"Optional token validation failed: {str(e)}. Returning anonymous user")
        return User(username="anonymous", disabled=False)

async def get_current_active_user_optional(current_user: Annotated[User, Depends(get_current_user_optional)]):
    return current_user