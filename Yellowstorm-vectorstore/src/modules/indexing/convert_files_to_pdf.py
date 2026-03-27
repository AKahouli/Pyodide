"""convert to pdf from datalake."""
import urllib.parse
from typing import Union
from pathlib import Path

import requests
from azure.storage.filedatalake import DataLakeFileClient

from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.modules.indexing.get_token_api_chunk import get_token

logger = get_logger(__name__)


def convert_to_pdf(file_bytes: bytes, filename: str) -> bytes:
    """
    Send binary content to an external API to convert to PDF and return the PDF bytes.

    Parameters
    ----------
    file_bytes : bytes
        The raw file content to convert
    filename : str
        The original filename (used as the upload field name)

    Returns
    -------
    bytes
        The raw PDF file content
    """
    settings = get_settings()

    api_url = urllib.parse.urljoin(settings.PDF_API_URL, "/convert-pdf")
    files = {"file": (filename, file_bytes, "application/octet-stream")}
    headers = {
        "Accept": "application/pdf",
    }

    logger.info(f"Converting binary {filename} → PDF via {api_url}")
    try:
        resp = requests.post(api_url, headers=headers, files=files, stream=True)
        resp.raise_for_status()
    except Exception as e:
        logger.error(f"PDF conversion request failed: {e}")
        raise

    pdf_bytes = resp.content
    logger.info(f"Received PDF ({len(pdf_bytes)} bytes)")
    return pdf_bytes


def upload_to_azure_datalake(
    file_path: str,
    destination_path: str,
) -> None:
    """
    Upload a file to Azure Data Lake

    Parameters
    ----------
    file_path : str
        The path of the file to upload
    destination_path : str
        The path to upload the file to
    """
    settings = get_settings()
    logger.info(f"Uploading file to Azure Data Lake: {file_path}")
    with DataLakeFileClient.from_connection_string(
        conn_str=settings.AZURE_DATALAKE_CONNECTION_STRING,
        file_system_name=settings.AZURE_DATALAKE_FILE_SYSTEM_NAME,
        file_path=destination_path,
    ) as file:
        with open(file_path, "rb") as my_file:
            file.upload_data(my_file, overwrite=True)
    logger.info(f"File uploaded to Azure Data Lake: {destination_path}")
    return None


def upload_bytes_to_azure_datalake(
        file_bytes: bytes,
        destination_path: str,
) -> None:
    """
    Upload a bytes to Azure Data Lake

    Parameters
    ----------
    file_bytes
    destination_path : str
        The path to upload the file to
    """
    settings = get_settings()

    with DataLakeFileClient.from_connection_string(
            conn_str=settings.AZURE_DATALAKE_CONNECTION_STRING,
            file_system_name=settings.AZURE_DATALAKE_FILE_SYSTEM_NAME,
            file_path=destination_path,
    ) as file:
        file.upload_data(file_bytes, overwrite=True)
    logger.info(f"File uploaded to Azure Data Lake: {destination_path}")
    return None


def download_file_from_azure_datalake_to_local(
        remote_path: Union[Path, str],
        local_path: Union[Path, str],
) -> str:
    """

    Args:
        remote_path:
        local_path:

    Returns:

    """
    settings = get_settings()
    logger.info(f"Downloading file from Azure Data Lake: {remote_path}")
    with DataLakeFileClient.from_connection_string(
            conn_str=settings.AZURE_DATALAKE_CONNECTION_STRING,
            file_system_name=settings.AZURE_DATALAKE_FILE_SYSTEM_NAME,
            file_path=remote_path,
    ) as file:
        download = file.download_file()
        with open(local_path, "wb") as my_file:
            download.readinto(my_file)
    return local_path


def download_file_from_azure_datalake_as_bytes(
        remote_path: Union[Path, str],
) -> bytes:
    """

    Args:
        remote_path:

    Returns:

    """
    settings = get_settings()
    logger.info(f"Downloading file from Azure Data Lake: {remote_path}")
    with DataLakeFileClient.from_connection_string(
            conn_str=settings.AZURE_DATALAKE_CONNECTION_STRING,
            file_system_name=settings.AZURE_DATALAKE_FILE_SYSTEM_NAME,
            file_path=remote_path,
    ) as file:
        download = file.download_file()

    return download.readall()
