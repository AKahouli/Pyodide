"""
Language detection and PostgreSQL FTS config mapping.

Uses the pre-provisioned fastText lid.176.bin model to detect the query language and map it to
the correct PostgreSQL text search configuration (regconfig).
"""
import hashlib
import os
import threading
from pathlib import Path
from typing import Optional

import fasttext

from src.logger.logging import get_logger

logger = get_logger(__name__)

MODEL_FILENAME = "lid.176.bin"
MODEL_SHA256 = "7e69ec5451bc261cc7844e49e4792a85d7f09c06789ec800fc4a44aec362764e"
DEFAULT_MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / MODEL_FILENAME

FASTTEXT_TO_PG_CONFIG = {
    "en": "english",
    "fr": "french",
    "de": "german",
    "es": "spanish",
    "it": "italian",
    "pt": "portuguese",
    "nl": "dutch",
    "ru": "russian",
    "da": "danish",
    "fi": "finnish",
    "hu": "hungarian",
    "el": "greek",
    "hi": "hindi",
    "id": "indonesian",
    "ga": "irish",
    "lt": "lithuanian",
    "ne": "nepali",
    "no": "norwegian",
    "ro": "romanian",
    "sq": "albanian",
    "hy": "armenian",
    "eu": "basque",
    "ca": "catalan",
    "he": "hebrew",
    "sv": "swedish",
    "ta": "tamil",
    "tr": "turkish",
    "ar": "arabic",
}

_model: Optional[fasttext.FastText._FastText] = None
_model_path: Optional[Path] = None
_model_lock = threading.Lock()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as model_file:
        for chunk in iter(lambda: model_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def initialize_language_model(
    model_path: str | os.PathLike[str] | None = None,
    expected_sha256: str = MODEL_SHA256,
) -> fasttext.FastText._FastText:
    """Verify and load the local model once; never download at runtime."""
    global _model, _model_path
    path = Path(model_path or os.getenv("LANGUAGE_MODEL_PATH", DEFAULT_MODEL_PATH)).resolve()
    with _model_lock:
        if _model is not None:
            if path != _model_path:
                raise RuntimeError(
                    f"Language model is already initialized from {_model_path}, not {path}"
                )
            return _model

        if not path.is_file():
            message = (
                f"Language model artifact is missing: {path}. "
                "Provision it before starting the service."
            )
            logger.error(message)
            raise RuntimeError(message)
        actual_sha256 = _sha256(path)
        if actual_sha256 != expected_sha256.lower():
            message = (
                f"Language model checksum mismatch for {path}: "
                f"expected {expected_sha256.lower()}, got {actual_sha256}"
            )
            logger.error(message)
            raise RuntimeError(message)

        try:
            _model = fasttext.load_model(str(path))
        except Exception:
            logger.exception("Failed to load fastText language model from %s", path)
            raise
        _model_path = path
        logger.info("Loaded verified fastText language model from %s", path)
        return _model


def _get_model() -> fasttext.FastText._FastText:
    return initialize_language_model()


def detect_language(text: str) -> str:
    if not text or len(text.strip()) < 3:
        return "en"
    model = _get_model()
    predictions = model.predict(text.replace("\n", " ").strip(), k=1)
    return predictions[0][0].replace("__label__", "")


def get_pg_ts_config(query: str) -> str:
    lang = detect_language(query)
    return FASTTEXT_TO_PG_CONFIG.get(lang, "simple")
