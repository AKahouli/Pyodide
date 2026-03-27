import tiktoken

from src.logger.logging import get_logger

logger = get_logger(__name__)


def num_tokens_from_string(string: str) -> int:
    """Returns the number of tokens in a text string."""
    logger.debug(f"Getting number of tokens in string: {string}")
    encoding = tiktoken.get_encoding("cl100k_base")
    num_tokens = len(encoding.encode(string))
    logger.debug(f"Number of tokens in string: {num_tokens}")
    return num_tokens
