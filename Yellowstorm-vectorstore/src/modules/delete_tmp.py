import datetime
import os
import shutil
from typing import List

from src.config.settings import get_settings
from src.logger.logging import get_logger

logger = get_logger(__name__)

# ────────────────────────── constants ──────────────────────────
TEMP_DIR_NAME = "tmp"


def delete_tmp() -> List[str]:
    """Delete files in the tmp folder that are older than TMP_DELETE_N_SECONDS seconds.

    Returns
    -------
    List[str]
        List of paths of the deleted files
    """
    settings = get_settings()
    logger.info(f"Deleting files in tmp folder that are older than {settings.TMP_DELETE_N_SECONDS} seconds")
    n_seconds = settings.TMP_DELETE_N_SECONDS
    now = datetime.datetime.now()
    deleted = []
    tmp_base_dir = os.path.join(settings.SHARED_VOLUME_PREFIX, TEMP_DIR_NAME)
    for f in os.listdir(tmp_base_dir):
        file_path = os.path.join(tmp_base_dir, f)
        if os.stat(file_path).st_mtime < now.timestamp() - n_seconds:
            logger.info(f"Deleting {file_path}")
            if os.path.isfile(file_path):
                os.remove(file_path)
            elif os.path.isdir(file_path):
                shutil.rmtree(file_path)
            deleted.append(file_path)
    logger.info(f"Deleted {len(deleted)} files")
    return deleted
