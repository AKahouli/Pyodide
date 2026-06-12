"""Function to get token from api chunker"""

import urllib.parse
from urllib.parse import urlencode
from src.config.settings import get_settings
from src.logger.logging import get_logger
import urllib
import requests

logger = get_logger(__name__)


settings = get_settings()

def get_token():
    """Function to get token from api chunker"""
    chunking_api_url = settings.CHUNKING_API_URL
    api_url = urllib.parse.urljoin(chunking_api_url, "api/General/login")
    try:
        headers = {
            'accept': '*/*',
        }
        files = {
            'Username': (None, settings.AUTH_CHUNKER_USERNAME),
            'Password': (None, settings.AUTH_CHUNKER_PASSWORD),
        }
        response = requests.post(url=api_url, headers=headers, files=files)
        response.raise_for_status()
        return response.json()["token"]
    except Exception as e:
        logger.error(f"Error getting token from api chunker: {e}")
        return None

