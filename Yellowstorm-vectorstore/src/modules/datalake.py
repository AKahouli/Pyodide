"""
Helpers for Azure Data Lake (ADLS Gen-2)

✱  Only minimal edits vs. your original file.
✱  One shared FileSystemClient for sync and one for async paths.
✱  Transport timeout cut to 0.1 s to avoid close-notify stalls.
"""

from __future__ import annotations
import re2 as re
import asyncio
import atexit
from pathlib import Path
from typing import Union, Optional
from uuid import uuid4

import aiofiles
# Transport (to shorten the TLS close-notify wait)
from azure.core.pipeline.transport import AioHttpTransport
# Azure SDK (sync + async)
from azure.storage.filedatalake import (
    DataLakeServiceClient as SyncServiceClient,
    DataLakeFileClient as SyncFileClient,  # ← sync client
)
from azure.storage.filedatalake.aio import (
    DataLakeServiceClient as AsyncServiceClient,
    DataLakeFileClient as AsyncFileClient,  # ← async client
    # or, if you prefer to keep the old name in the rest of the code:
    # DataLakeFileClient    as FileClient,
)
import os
from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.modules.indexing.convert_files_to_pdf import convert_to_pdf
from src.schema.fastapi.vectorstores.requests import (
    VectorstoreValidationError,
    VectorstoreIndexingError,
    VectorstoreConnectionError
)
from azure.storage.filedatalake.aio import DataLakeFileClient as FileClient

logger = get_logger(__name__)
_settings = get_settings()

# ────────────────────────── constants ──────────────────────────
TEMP_DIR_NAME = "tmp"

# ───────────────────────── path validation ───────────────────────
def validate_safe_path(file_path: str, base_dir: Optional[str] = None) -> str:
    """
    Validate that a file path doesn't contain path traversal sequences
    and optionally check if it's within a base directory.

    Args:
        file_path: The file path to validate
        base_dir: Optional base directory to restrict paths to

    Returns:
        The validated absolute path

    Raises:
        VectorstoreValidationError: If path contains traversal sequences or is outside base_dir
    """
    if not file_path or not isinstance(file_path, str):
        raise VectorstoreValidationError(
            message="File path must be a non-empty string",
            field="file_path",
            details={"provided_value": file_path}
        )

    # Check for path traversal patterns
    dangerous_patterns = ['..', '~', '\x00']
    for pattern in dangerous_patterns:
        if pattern in file_path:
            raise VectorstoreValidationError(
                message=f"File path contains invalid pattern: {pattern}",
                field="file_path",
                details={"provided_path": file_path, "invalid_pattern": pattern}
            )

    # Normalize and resolve the path
    try:
        abs_path = os.path.abspath(os.path.normpath(file_path))
    except (ValueError, OSError) as e:
        raise VectorstoreValidationError(
            message="Invalid file path format",
            field="file_path",
            details={"provided_path": file_path, "error": str(e)}
        )

    # If base_dir is provided, ensure the path is within it
    if base_dir:
        try:
            abs_base = os.path.abspath(os.path.normpath(base_dir))
            if not abs_path.startswith(abs_base + os.sep) and abs_path != abs_base:
                raise VectorstoreValidationError(
                    message="File path is outside allowed directory",
                    field="file_path",
                    details={"provided_path": file_path, "base_directory": base_dir}
                )
        except (ValueError, OSError) as e:
            raise VectorstoreValidationError(
                message="Invalid base directory format",
                field="base_dir",
                details={"base_dir": base_dir, "error": str(e)}
            )

    return abs_path

# ────────────────────────── singletons ──────────────────────────
_TRANSPORT = AioHttpTransport(ssl_close_notify_timeout=0.1)  # <- key change

_sync_service: SyncServiceClient | None = None
_async_service: AsyncServiceClient | None = None


def _sync_fs() -> SyncServiceClient.FileSystemClient:
    global _sync_service
    if _sync_service is None:
        _sync_service = SyncServiceClient.from_connection_string(
            _settings.AZURE_DATALAKE_CONNECTION_STRING
        )
    return _sync_service.get_file_system_client(_settings.AZURE_DATALAKE_FILE_SYSTEM_NAME)


def _async_fs() -> AsyncServiceClient.FileSystemClient:
    global _async_service
    if _async_service is None:
        _async_service = AsyncServiceClient.from_connection_string(
            _settings.AZURE_DATALAKE_CONNECTION_STRING,
            transport=_TRANSPORT,
        )
    return _async_service.get_file_system_client(_settings.AZURE_DATALAKE_FILE_SYSTEM_NAME)


# ────────────────────────── sync helpers ──────────────────────────
def download_from_azure_datalake(
    file_path: str,
    temp_folder: Optional[str] = None
) -> str:
    """
    Download a file from ADLS without conversion. Returns the local path.

    This function only downloads files - conversion is handled separately by
    convert_to_pdf_task for non-PDF documents.

    Raises
    ------
    VectorstoreValidationError
        If input file_path is missing or empty
    VectorstoreIndexingError
        For any failure during directory creation, download
    """
    logger.info("↓ (sync) %s", file_path)

    # Validate input
    if not file_path or not file_path.strip():
        raise VectorstoreValidationError(
            message="File path is required and cannot be empty",
            field="file_path",
            details={"provided_value": file_path}
        )

    ext = Path(file_path).suffix.lower()

    # Prepare temp_folder
    try:
        if not temp_folder:
            temp_folder = os.path.join(
                _settings.SHARED_VOLUME_PREFIX,
                TEMP_DIR_NAME,
                str(uuid4())
            )
        # Validate temp_folder path is within SHARED_VOLUME_PREFIX
        temp_folder = validate_safe_path(temp_folder, _settings.SHARED_VOLUME_PREFIX)
        os.makedirs(temp_folder, exist_ok=True)
    except OSError as e:
        raise VectorstoreIndexingError(
            message=f"Failed to create temporary directory: {temp_folder}",
            indexing_operation="create_temp_directory",
            details={"temp_folder": temp_folder, "error": str(e)}
        )

    file_client: SyncFileClient = _sync_fs().get_file_client(file_path)
    # Validate output path is within temp_folder
    output_path = os.path.join(temp_folder, os.path.basename(file_path))
    output_path = validate_safe_path(output_path, temp_folder)

    # Direct download without conversion
    try:
        logger.info(f"Saving file to {output_path}")
        with open(output_path, "wb") as fh:
            file_client.download_file().readinto(fh)
    except FileNotFoundError:
        raise VectorstoreIndexingError(
            message=f"File not found in Azure Data Lake: {file_path}",
            indexing_operation="download_file",
            details={"file_path": file_path, "output_path": output_path}
        )
    except PermissionError as e:
        raise VectorstoreIndexingError(
            message=f"Permission denied when saving file to: {output_path}",
            indexing_operation="save_file",
            details={"output_path": output_path, "error": str(e)}
        )

    # Verify download
    if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        raise VectorstoreIndexingError(
            message=f"File download failed or resulted in empty file: {output_path}",
            indexing_operation="verify_download",
            details={"file_path": file_path, "output_path": output_path}
        )

    return output_path



def upload_to_azure_datalake(src_path: str, dest_path: str) -> None:
    logger.info("↑ %s → %s", src_path, dest_path)

    # Validate inputs
    if not src_path or not src_path.strip():
        raise VectorstoreValidationError(
            message="Source path is required and cannot be empty",
            field="src_path",
            details={"provided_value": src_path}
        )

    if not dest_path or not dest_path.strip():
        raise VectorstoreValidationError(
            message="Destination path is required and cannot be empty",
            field="dest_path",
            details={"provided_value": dest_path}
        )

    # Check if source file exists
    if not os.path.exists(src_path):
        raise VectorstoreIndexingError(
            message=f"Source file does not exist: {src_path}",
            indexing_operation="validate_source_file",
            details={"src_path": src_path}
        )

    try:
        file_client = _sync_fs().get_file_client(dest_path)
        with open(src_path, "rb") as fh:
            file_client.upload_data(fh, overwrite=True)
    except FileNotFoundError:
        raise VectorstoreIndexingError(
            message=f"Source file not found during upload: {src_path}",
            indexing_operation="upload_file",
            details={"src_path": src_path, "dest_path": dest_path}
        )
    except PermissionError as e:
        raise VectorstoreIndexingError(
            message=f"Permission denied when reading source file: {src_path}",
            indexing_operation="read_source_file",
            details={"src_path": src_path, "error": str(e)}
        )
    except Exception as e:
        raise VectorstoreConnectionError(
            message=f"Failed to upload file to Azure Data Lake: {src_path} → {dest_path}",
            connection_target="azure_datalake",
            details={"src_path": src_path, "dest_path": dest_path, "error": str(e)}
        )


# ────────────────────────── async helpers ──────────────────────────
async def async_download_from_azure_datalake(file_path: str) -> str:
    logger.info("↓ (async) %s", file_path)

    ext = Path(file_path).suffix.lower()
    if ext not in [".pdf", ".json", ".txt", ".png"]:
        logger.info("Will convert later → %s", file_path)

    file_client: AsyncFileClient = _async_fs().get_file_client(file_path)

    temp_folder = os.path.join(_settings.SHARED_VOLUME_PREFIX, TEMP_DIR_NAME, str(uuid4()))
    output_path = os.path.join(temp_folder, os.path.basename(file_path))
    os.makedirs(temp_folder, exist_ok=True)
    logger.info(f"Saving file to {output_path}")
    download = await file_client.download_file()
    async with aiofiles.open(output_path, "wb") as fh:
        async for chunk in download.chunks():
            await fh.write(chunk)

    return output_path


async def async_download_from_azure_datalake_with_temp_folder(
    file_path: str,
    temp_folder: str
) -> str:
    """
    Async download from Azure Data Lake to a specified temp folder.

    This version accepts a temp_folder parameter instead of creating one internally.
    Useful when you want to reuse an existing temp folder for a workflow.

    Parameters
    ----------
    file_path : str
        Path to the file in Azure Data Lake
    temp_folder : str
        Local temp folder path where the file will be saved

    Returns
    -------
    str
        Local path to the downloaded file
    """
    logger.info("↓ (async with temp_folder) %s", file_path)

    ext = Path(file_path).suffix.lower()
    if ext not in [".pdf", ".json", ".txt", ".png"]:
        logger.info("Will convert later → %s", file_path)

    file_client: AsyncFileClient = _async_fs().get_file_client(file_path)

    os.makedirs(temp_folder, exist_ok=True)
    output_path = os.path.join(temp_folder, os.path.basename(file_path))
    logger.info(f"Saving file to {output_path}")

    download = await file_client.download_file()
    async with aiofiles.open(output_path, "wb") as fh:
        async for chunk in download.chunks():
            await fh.write(chunk)

    return output_path


async def async_download_file_from_azure_datalake_as_bytes(
        remote_path: Union[str, Path]
) -> bytes:
    file_client = _async_fs().get_file_client(str(remote_path))
    download = await file_client.download_file()
    return await download.readall()


def convert_file_to_pdf_and_upload(
    original_file_path: str,
    temp_folder: str
) -> str:
    """
    Convert a non-PDF file to PDF and upload it to Azure Data Lake.

    This function:
    1. Downloads the original file from Data Lake
    2. Converts it to PDF using external API
    3. Saves the PDF locally
    4. Uploads the PDF back to Data Lake
    5. Returns the local PDF path

    Parameters
    ----------
    original_file_path : str
        The original file path in Data Lake
    temp_folder : str
        Local temporary folder for processing

    Returns
    -------
    str
        Local path to the converted PDF file

    Raises
    ------
    VectorstoreIndexingError
        For any failure during download, conversion, or upload
    """
    from pathlib import Path

    logger.info(f"Converting file to PDF: {original_file_path}")

    file_client: SyncFileClient = _sync_fs().get_file_client(original_file_path)

    # Download original file for conversion
    try:
        logger.info(f"Downloading original blob for conversion: {original_file_path}")
        orig_bytes = file_client.download_file().readall()
    except Exception as e:
        raise VectorstoreIndexingError(
            message=f"Failed to download original blob for conversion: {original_file_path}",
            indexing_operation="download_for_conversion",
            details={"original_file_path": original_file_path, "error": str(e)}
        )

    # Convert to PDF
    filename = Path(original_file_path).name
    try:
        pdf_bytes = convert_to_pdf(orig_bytes, filename)
    except Exception as e:
        raise VectorstoreIndexingError(
            message=f"Failed to convert file to PDF: {original_file_path}",
            indexing_operation="convert_to_pdf",
            details={"original_file_path": original_file_path, "error": str(e)}
        )

    # Save PDF locally
    pdf_name = Path(original_file_path).with_suffix(".pdf").name
    pdf_output_path = os.path.join(temp_folder, pdf_name)
    pdf_output_path = validate_safe_path(pdf_output_path, temp_folder)

    try:
        with open(pdf_output_path, "wb") as f:
            f.write(pdf_bytes)
    except PermissionError as e:
        raise VectorstoreIndexingError(
            message=f"Permission denied when saving PDF: {pdf_output_path}",
            indexing_operation="save_pdf",
            details={"pdf_output_path": pdf_output_path, "error": str(e)}
        )

    # Upload PDF to Data Lake
    pdf_blob_path = str(Path(original_file_path).with_suffix(".pdf"))
    pdf_client: SyncFileClient = _sync_fs().get_file_client(pdf_blob_path)
    try:
        pdf_client.upload_data(pdf_bytes, overwrite=True)
        logger.info(f"Uploaded PDF to Data Lake: {pdf_blob_path}")
    except Exception as e:
        raise VectorstoreIndexingError(
            message=f"Failed to upload PDF to Data Lake: {pdf_blob_path}",
            indexing_operation="upload_pdf",
            details={"pdf_blob_path": pdf_blob_path, "error": str(e)}
        )

    return pdf_output_path


def sanitize_filename(name):
    # Supprime ou remplace les caractères interdits dans les noms de fichiers
    return re.sub(r'[<>:"/\\|?*]', '_', name)

async def async_download_file_from_azure_datalake_custom(adl_file_path:str, user_id:str)->str:
    try:
        async with FileClient.from_connection_string(
                conn_str=_settings.AZURE_DATALAKE_CONNECTION_STRING,
                file_system_name=_settings.AZURE_DATALAKE_FILE_SYSTEM_NAME,
                file_path=adl_file_path,
        ) as file:
            temp_folder = os.path.join(f"{_settings.SHARED_VOLUME_PREFIX}/tmp_mcp", sanitize_filename(user_id))
            output_path = os.path.join(temp_folder, os.path.basename(adl_file_path))
            os.makedirs(temp_folder, exist_ok=True)
            logger.info(f"Saving file to {output_path}")

            download = await file.download_file()

            async with aiofiles.open(output_path, "wb") as my_file:
                await my_file.write(await download.readall())

        return output_path
    except Exception as e:
        logger.error(f"error occured in async_download_file_from_azure_datalake_custom: {e}")

# ────────────────────────── folder helpers (unchanged API) ──────────────────────────
def upload_folder_to_datalake(directory_path: str, local_folder_path: str) -> str:
    fs_client = _sync_fs()
    directory_path = f"{directory_path.rstrip('/')}/graph"

    dir_client = fs_client.get_directory_client(directory_path)
    try:
        dir_client.create_directory()
    except Exception:
        pass  # probably exists

    for root, _, files in os.walk(local_folder_path):
        for name in files:
            loc = Path(root) / name
            rel = os.path.relpath(loc, local_folder_path).replace("\\", "/")
            dest = f"{directory_path}/{rel}"

            file_client = fs_client.get_file_client(dest)
            with open(loc, "rb") as fh:
                file_client.upload_data(fh, overwrite=True)
            logger.info("↑ %s", dest)

    return directory_path


def download_directory_from_datalake(remote_dir: str, local_dir: str) -> None:
    fs_client = _sync_fs()
    if os.path.exists(local_dir):
        logger.info("Local %s exists, skipping.", local_dir)
        return

    for path in fs_client.get_paths(remote_dir):
        if path.is_directory:
            continue
        rel = os.path.relpath(path.name, remote_dir)
        loc = Path(local_dir) / rel
        loc.parent.mkdir(parents=True, exist_ok=True)
        file_client = fs_client.get_file_client(path.name)
        with open(loc, "wb") as fh:
            fh.write(file_client.download_file().readall())
        logger.info("↓ %s", loc)


# ────────────────────────── graceful shutdown ──────────────────────────
async def _async_shutdown():
    if _async_service:
        await _async_service.close()


def _sync_shutdown():
    if _sync_service:
        _sync_service.close()


def _shutdown():
    loop = asyncio.get_event_loop()
    if loop.is_running():
        loop.create_task(_async_shutdown())
    else:
        loop.run_until_complete(_async_shutdown())
    _sync_shutdown()


atexit.register(_shutdown)

import os
import fitz  # PyMuPDF


def convert_file_to_txt(file_path):
    """
    If file_path is a PDF, converts it to a text file using PyMuPDF (fitz)
    and saves it in the same directory as the original PDF.
    Returns the new text file path. Otherwise, returns the original file path.
    """
    # Validate input
    if not file_path or not file_path.strip():
        raise VectorstoreValidationError(
            message="File path is required and cannot be empty",
            field="file_path",
            details={"provided_value": file_path}
        )

    if not os.path.exists(file_path):
        raise VectorstoreIndexingError(
            message=f"File does not exist: {file_path}",
            indexing_operation="validate_file_exists",
            details={"file_path": file_path}
        )

    if file_path.lower().endswith('.pdf'):
        # Use context manager to ensure PDF document is properly closed
        try:
            with fitz.open(file_path) as doc:
                text_content = []
                for page in doc:
                    text_content.append(page.get_text())
                full_text = "\n".join(text_content)

            directory = os.path.dirname(file_path)
            base_name = os.path.splitext(os.path.basename(file_path))[0]
            new_file_path = os.path.join(directory, base_name + '.txt')

            try:
                with open(new_file_path, 'w', encoding='utf-8') as txt_file:
                    txt_file.write(full_text)
            except PermissionError as e:
                raise VectorstoreIndexingError(
                    message=f"Permission denied when creating text file: {new_file_path}",
                    indexing_operation="create_text_file",
                    details={"new_file_path": new_file_path, "error": str(e)}
                )

            return new_file_path

        except VectorstoreIndexingError:
            # Re-raise custom errors
            raise
        except Exception as e:
            if "fitz" in str(e) or "PDF" in str(e):
                raise VectorstoreIndexingError(
                    message=f"Failed to convert PDF to text: {file_path}",
                    indexing_operation="pdf_to_text_conversion",
                    details={"file_path": file_path, "error": str(e)}
                )
            else:
                raise VectorstoreIndexingError(
                    message=f"Unexpected error during PDF conversion: {file_path}",
                    indexing_operation="pdf_conversion",
                    details={"file_path": file_path, "error": str(e)}
                )
    else:
        return file_path


def extract_text_from_first_n_pages(pdf_path: str, n_pages: int = 10) -> str:
    """
    Extract text from the first N pages of a PDF file.

    Parameters
    ----------
    pdf_path : str
        Local path to the PDF file
    n_pages : int, optional
        Number of pages to extract (default: 10)

    Returns
    -------
    str
        Extracted text content from the first N pages

    Raises
    ------
    VectorstoreIndexingError
        If PDF cannot be opened or text extraction fails
    """
    import fitz

    try:
        doc = fitz.open(pdf_path)
        pages_text = []

        # Extract text from first N pages
        for i in range(min(n_pages, len(doc))):
            page = doc.load_page(i)
            text = page.get_text("text")
            if text.strip():  # Only add non-empty pages
                pages_text.append(text)

        doc.close()
        return "\n\n".join(pages_text)

    except Exception as e:
        logger.error(f"Failed to extract text from PDF {pdf_path}: {str(e)}")
        raise VectorstoreIndexingError(
            message=f"Failed to extract text from PDF",
            indexing_operation="pdf_text_extraction",
            details={"error": str(e), "file_path": pdf_path}
        )


def extract_text_from_document(
    file_path: str,
    max_pages: int = 10,
    sheet_name: Optional[str] = None
) -> str:
    """
    Extract text from a document based on its file type using Haystack converters.

    Supports PDF, Excel (.xlsx, .xls), PowerPoint (.pptx, .ppt),
    Word (.docx, .doc), and Text (.txt) files.

    Parameters
    ----------
    file_path : str
        Local path to the document file
    max_pages : int, optional
        Maximum number of pages/sheets/slides to extract (default: 10)
    sheet_name : str, optional
        Sheet name for Excel files. If not provided, all sheets will be processed.

    Returns
    -------
    str
        Extracted text content from the document

    Raises
    ------
    VectorstoreIndexingError
        If file type is not supported or text extraction fails
    """
    from pathlib import Path
    from haystack.components.converters import (
        TextFileToDocument,
        PyPDFToDocument,
        XLSXToDocument,
        DOCXToDocument,
        PPTXToDocument,
    )
    from haystack.dataclasses import Document as HaystackDocument

    # Validate input
    if not file_path or not file_path.strip():
        raise VectorstoreValidationError(
            message="File path is required and cannot be empty",
            field="file_path",
            details={"provided_value": file_path}
        )

    if not os.path.exists(file_path):
        raise VectorstoreIndexingError(
            message=f"File does not exist: {file_path}",
            indexing_operation="validate_file_exists",
            details={"file_path": file_path}
        )

    file_ext = Path(file_path).suffix.lower()

    try:
        # Select the appropriate Haystack converter based on file type
        if file_ext == '.pdf':
            converter = PyPDFToDocument()
        elif file_ext in ('.xlsx', '.xls'):
            # Use sheet_name parameter if provided for Excel files
            if sheet_name:
                converter = XLSXToDocument(sheet_name=sheet_name)
            else:
                converter = XLSXToDocument()
        elif file_ext in ('.pptx', '.ppt'):
            converter = PPTXToDocument()
        elif file_ext in ('.docx', '.doc'):
            converter = DOCXToDocument()
        elif file_ext == '.txt':
            converter = TextFileToDocument()
        else:
            raise VectorstoreIndexingError(
                message=f"Unsupported file format: {file_ext}",
                indexing_operation="file_type_check",
                details={"file_path": file_path, "file_ext": file_ext}
            )

        # Run the converter
        result = converter.run(sources=[Path(file_path)])
        documents: list[HaystackDocument] = result["documents"]

        if not documents:
            raise VectorstoreIndexingError(
                message=f"No content extracted from {file_ext.upper()} file",
                indexing_operation="document_conversion",
                details={"file_path": file_path, "file_ext": file_ext, "sheet_name": sheet_name}
            )

        # Combine all document content
        combined_text = "\n\n".join(doc.content for doc in documents)

        # For large documents, limit content (simulate max_pages behavior)
        if file_ext != '.txt' and len(combined_text) > 50000:
            # Approximate limit based on max_pages * typical page size
            combined_text = combined_text[:50000]

        return combined_text

    except VectorstoreIndexingError:
        raise
    except Exception as e:
        logger.error(f"Failed to extract text from {file_path}: {str(e)}")
        raise VectorstoreIndexingError(
            message=f"Failed to extract text from document",
            indexing_operation="text_extraction",
            details={"error": str(e), "file_path": file_path, "file_ext": file_ext, "sheet_name": sheet_name}
        )