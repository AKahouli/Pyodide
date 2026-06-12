import asyncio
from typing import Annotated
import redis
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
import jwt
from jwt import PyJWTError
from src.config.settings import get_settings
from src.helpers.authentification import get_user
from src.logger.logging import get_logger
from src.schema.authentification import TokenData, User

logger = get_logger("vectorstores-api.main")
app_settings = get_settings()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=app_settings.AUTH_SERVICE_URL + "token")

# Redis connection setup
try:
    r = redis.Redis(
        host=app_settings.REDIS_HOST,
        port=app_settings.REDIS_PORT,
        db=app_settings.REDIS_DB,
        username=app_settings.REDIS_USER,
        password=app_settings.REDIS_PASSWORD,
        ssl=getattr(app_settings, 'ENABLE_REDIS_SSL', False)
    )
    logger.info("Redis connection established")
except Exception as e:
    logger.error(f"Failed to establish Redis connection: {e}")
    raise

async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]):
    logger.info("Starting user authentication process")
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        logger.info("Decoding JWT token")
        payload = jwt.decode(token, app_settings.SECRET_KEY, algorithms=[app_settings.ALGORITHM])
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
    logger.info("Retrieving user from Redis")
    user = await asyncio.to_thread(get_user, r, username=token_data.username)  # type: ignore
    if user is None:
        logger.info("User not found in Redis")
        raise credentials_exception
    logger.info("User authentication completed successfully")
    return user

def get_current_active_user(current_user: Annotated[User, Depends(get_current_user)]):
    logger.info("Checking user active status")
    if current_user.disabled:
        logger.info("User account is disabled")
        raise HTTPException(status_code=400, detail="Inactive user")
    logger.info("User is active, authentication process completed")
    return current_user
