import json
from datetime import datetime, timedelta,timezone
from typing import Union
import redis
import jwt
from passlib.context import CryptContext
from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.schema.authentification import User, UserInDB

logger = get_logger("api.main")
app_settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
def fake_decode_token(token: str) -> User:
    return User(username=token + "fakedecoded", email="john@example.com", full_name="John Doe")
def get_user(r: redis.Redis, username: str) -> Union[UserInDB, None]:
    """
    Get user from redis
    Args:
        r (redis.Redis): Redis connection
        username (str): Username
    Returns:
        Union[UserInDB, None]: UserInDB or None
    """
    logger.info("Attempting to retrieve user from Redis")
    user = r.get(username)
    if user is None:
        logger.info("User not found in Redis")
        return None
    user = json.loads(user)
    logger.info("User successfully retrieved and parsed from Redis")
    return UserInDB(**user)
def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)
def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(secret=plain_password, hash=hashed_password)
def authenticate_user(r: redis.Redis, username: str, password: str):
    logger.info("Starting user authentication process")
    user = get_user(r, username)
    if not user:
        logger.info("Authentication failed: user not found")
        return False
    if not verify_password(password, user.hashed_password):
        logger.info("Authentication failed: password verification failed")
        return False
    logger.info("User authentication successful")
    return user
def create_access_token(data: dict, expires_delta: timedelta | None = None):
    logger.info("Creating access token")
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, app_settings.SECRET_KEY, algorithm=app_settings.ALGORITHM)
    logger.info("Access token created successfully")
    return encoded_jwt