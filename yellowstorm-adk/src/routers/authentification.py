import json
from datetime import timedelta
from typing import Annotated

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from passlib.context import CryptContext
import jwt
from datetime import datetime, timezone

from src.config.settings import get_settings
from src.schema.authentification_schema import Token, User, UserInDB
from src.logger.logging import get_logger
from src.authentification.get_current_user import redis_manager


app_settings = get_settings()
logger = get_logger("api.auth")
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

router = APIRouter(
    tags=["authentication"],
)


def get_password_hash(password: str) -> str:
    """Hash a password using bcrypt."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash."""
    return pwd_context.verify(secret=plain_password, hash=hashed_password)


async def get_user(r: aioredis.Redis, username: str) -> UserInDB | None:
    """
    Get user from Redis using async connection.

    Args:
        r (aioredis.Redis): Async Redis connection
        username (str): Username

    Returns:
        UserInDB | None: User object or None if not found
    """
    logger.info("Attempting to retrieve user from Redis")
    user_data = await r.get(username)
    if user_data is None:
        logger.info("User not found in Redis")
        return None
    user = json.loads(user_data)
    logger.info("User successfully retrieved and parsed from Redis")
    return UserInDB(**user)


async def authenticate_user(r: aioredis.Redis, username: str, password: str) -> UserInDB | bool:
    """
    Authenticate a user against Redis.

    Args:
        r (aioredis.Redis): Async Redis connection
        username (str): Username
        password (str): Plain text password

    Returns:
        UserInDB | bool: User object if authentication successful, False otherwise
    """
    logger.info("Starting user authentication process")
    user = await get_user(r, username)
    if not user:
        logger.info("Authentication failed: user not found")
        return False
    if not verify_password(password, user.hashed_password):
        logger.info("Authentication failed: password verification failed")
        return False
    logger.info("User authentication successful")
    return user


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """
    Create a JWT access token.

    Args:
        data (dict): Data to encode in the token
        expires_delta (timedelta | None): Token expiration time

    Returns:
        str: JWT token
    """
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


@router.post(
    "/token",
    response_model=Token,
    summary="Login to get an access token",
    description="Login to get an access token",
)
async def login_for_access_token(form_data: Annotated[OAuth2PasswordRequestForm, Depends()]):
    """
    Authenticate user and return JWT access token.

    Args:
        form_data: OAuth2 password form with username and password

    Returns:
        Token: JWT access token

    Raises:
        HTTPException: If authentication fails
    """
    logger.info("Authentication token request initiated")
    logger.info(f"Login attempt for user {form_data.username}")
    logger.info(f"Retrieving user from Redis on {app_settings.REDIS_HOST}:{app_settings.REDIS_PORT}")

    # Get async Redis connection
    r = await redis_manager.get_redis_connection()

    user = await authenticate_user(r, form_data.username, form_data.password)
    if not user:
        logger.info(f"Login failed for user {form_data.username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    logger.info(f"Login successful for user {form_data.username}")
    logger.info(f"Creating access token for user {form_data.username}")
    access_token_expires = timedelta(minutes=app_settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(data={"sub": user.username}, expires_delta=access_token_expires)
    logger.info(f"Access token created for user {form_data.username}")
    return {"access_token": access_token, "token_type": "bearer"}


@router.post(
    "/register",
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user",
    description="Register a new user",
)
async def register(form_data: Annotated[OAuth2PasswordRequestForm, Depends()]):
    """
    Register a new user in Redis.

    Args:
        form_data: OAuth2 password form with username and password

    Returns:
        dict: Success message

    Raises:
        HTTPException: If user already exists
    """
    logger.info("User registration request initiated")
    logger.info(f"Registering new user {form_data.username}")

    # Get async Redis connection
    r = await redis_manager.get_redis_connection()

    # Check if user already exists
    existing_user = await r.get(form_data.username)
    if existing_user is not None:
        logger.info(f"User {form_data.username} already exists")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User already exists",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Create new user
    logger.info(f"Creating new user {form_data.username}")
    hashed_password = get_password_hash(form_data.password)
    user = {
        "username": form_data.username,
        "hashed_password": hashed_password,
        "disabled": False,
    }

    logger.info(
        f"Saving new user {form_data.username} to redis database on {app_settings.REDIS_HOST}:{app_settings.REDIS_PORT}"
    )
    await r.set(form_data.username, json.dumps(user))
    logger.info(f"New user {form_data.username} saved to redis database")

    return {"message": "User registered successfully"}