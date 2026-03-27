import numpy as np

from src.logger.logging import get_logger

logger = get_logger(__name__)


def image_is_blank(image: np.ndarray, std_threshold: float = 0.1) -> bool:
    """
    Check if an image is blank

    Parameters
    ----------
    image : np.ndarray
        Image to check
    threshold : float
        Threshold for the standard deviation of the image

    Returns
    -------
    bool
        Whether the image is blank
    """
    logger.debug(f"Checking if image is blank with std_threshold {std_threshold}")
    return np.std(image) < std_threshold  # type: ignore


def image_is_small(image: np.ndarray, size_threshold: int = 60) -> bool:
    """
    Check if an image is small

    Parameters
    ----------
    image : np.ndarray
        Image to check
    size_threshold : int
        Threshold for the size of the image

    Returns
    -------
    bool
        Whether the image is small
    """
    logger.debug(f"Checking if image is small with size_threshold {size_threshold}")
    return any([dim < size_threshold for dim in image.shape[:2]])  # type: ignore


def image_maybe_relevant(image: np.ndarray, std_threshold: float = 0.1, size_threshold: int = 60) -> bool:
    """
    Check if an image is maybe relevant

    Parameters
    ----------
    image : np.ndarray
        Image to check
    std_threshold : float
        Threshold for the standard deviation of the image
    size_threshold : int
        Threshold for the size of the image

    Returns
    -------
    bool
        Whether the image is maybe relevant
    """
    logger.debug("Checking if image is maybe relevant")
    return not (image_is_blank(image, std_threshold) or image_is_small(image, size_threshold))
