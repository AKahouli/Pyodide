"""Language detection module using FastText."""
import os
import tempfile
import urllib.request
from typing import Optional
import fasttext

from src.config.settings import get_settings
from src.logger.logging import get_logger

logger = get_logger(__name__)
settings = get_settings()

# Global model variable for caching
_language_model: Optional[fasttext.FastText._FastText] = None
MODEL_URL = "https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.bin"
MODEL_FILENAME = "lid.176.bin"


def _download_model_if_needed() -> str:
    """Download the FastText language detection model if not already present."""
    model_path = os.path.join(tempfile.gettempdir(), MODEL_FILENAME)
    
    if not os.path.exists(model_path):
        logger.info(f"Downloading FastText language detection model to {model_path}")
        try:
            urllib.request.urlretrieve(MODEL_URL, model_path)
            logger.info("Successfully downloaded FastText language detection model")
        except Exception as e:
            logger.error(f"Failed to download FastText model: {str(e)}")
            raise RuntimeError(f"Could not download language detection model: {str(e)}")
    
    return model_path


def _get_language_model() -> fasttext.FastText._FastText:
    """Get or initialize the FastText language detection model."""
    global _language_model
    
    if _language_model is None:
        model_path = _download_model_if_needed()
        try:
            logger.info(f"Loading FastText model from {model_path}")
            _language_model = fasttext.load_model(model_path)
            logger.info("Successfully loaded FastText language detection model")
        except Exception as e:
            logger.error(f"Failed to load FastText model: {str(e)}")
            raise RuntimeError(f"Could not load language detection model: {str(e)}")
    
    return _language_model


def detect_language(text: str) -> str:
    """
    Detect the language of a given text using FastText.
    
    Args:
        text (str): The text chunk to detect language for
        
    Returns:
        str: The detected language code (e.g., 'en', 'fr', 'es', etc.)
        
    Raises:
        ValueError: If text is empty or None
        RuntimeError: If model loading fails
    """
    if not text or not text.strip():
        raise ValueError("Text cannot be empty or None")
    
    # Clean the text for better detection
    cleaned_text = text.strip().replace('\n', ' ').replace('\r', ' ')
    
    # FastText works better with longer text, but handle short texts too
    if len(cleaned_text) < 3:
        logger.warning(f"Text is very short ({len(cleaned_text)} chars), detection may be unreliable")
    
    try:
        model = _get_language_model()
        
        # Predict language - returns tuple of (labels, probabilities)
        predictions = model.predict(cleaned_text, k=1)
        
        # Extract language code (remove __label__ prefix)
        language_code = predictions[0][0].replace('__label__', '')
        confidence = predictions[1][0]
        
        logger.debug(f"Detected language: {language_code} (confidence: {confidence:.3f})")
        
        # Return just the language code (e.g., 'en' instead of 'en' with confidence)
        return language_code
        
    except Exception as e:
        logger.error(f"Error detecting language for text: {str(e)}")
        # Return 'unknown' as fallback instead of raising
        return 'unknown'


def detect_language_with_confidence(text: str) -> tuple[str, float]:
    """
    Detect the language of a given text using FastText with confidence score.
    
    Args:
        text (str): The text chunk to detect language for
        
    Returns:
        tuple[str, float]: The detected language code and confidence score
        
    Raises:
        ValueError: If text is empty or None
        RuntimeError: If model loading fails
    """
    if not text or not text.strip():
        raise ValueError("Text cannot be empty or None")
    
    cleaned_text = text.strip().replace('\n', ' ').replace('\r', ' ')
    
    try:
        model = _get_language_model()
        predictions = model.predict(cleaned_text, k=1)
        
        language_code = predictions[0][0].replace('__label__', '')
        confidence = float(predictions[1][0])
        
        logger.debug(f"Detected language: {language_code} (confidence: {confidence:.3f})")
        
        return language_code, confidence
        
    except Exception as e:
        logger.error(f"Error detecting language for text: {str(e)}")
        return 'unknown', 0.0