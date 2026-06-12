"""Style aware chunking module."""

import json
import urllib.parse
from typing import Any, Dict, List, Callable
import os
from uuid import uuid4

import requests
from langchain_core.documents import Document

from src.modules.indexing.get_token_api_chunk import get_token

from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.schema.chunk_style import ChunkStyle

logger = get_logger(__name__)

# ────────────────────────── constants ──────────────────────────
TEMP_DIR_NAME = "tmp"


def style_aware_split_pdf_from_azure_datalake(
    blob_path: str, chunk_styles: List[ChunkStyle], metadata: Dict[str, Any], upload_to_azure_datalake : Callable, correlation_id:str
) -> List[Document]:
    """
    Split a pdf from Azure Data Lake into documents using style aware splitting

    Parameters
    ----------
    blob_path : str
        The path of the blob in Azure Data Lake
    chunk_styles : List[ChunkStyle]
        The chunk styles

    Returns
    -------
    List[Document]
        The documents
    """
    try:
        settings = get_settings()
        token = get_token()
        chunking_api_url = settings.CHUNKING_API_URL
        api_url = urllib.parse.urljoin(chunking_api_url, "api/Pdf/custom-chunker-from-datalake")
        chunk_styles_dicts = [cs.dict() for cs in chunk_styles]
        files = {
            "filePath": (None, blob_path),
            "headerStylesString": (None, json.dumps(chunk_styles_dicts)),
        }
        correlation_id = str(uuid4()) if not correlation_id else correlation_id
        headers = {
            "accept": "*/*",
            'Authorization': f"Bearer {token}",
            "correlation-id": correlation_id
        }
        logger.info(f"Sending POST request to {api_url}, headers: {headers}, files: {files}")
        response = requests.post(api_url, headers=headers, files=files, timeout=60 * 60)
        response.raise_for_status()
        chunks = response.json()
        parts = blob_path.split('/')
        brain = parts[0]
        file_id = parts[1].split('.')[0]
        # Create the output folder
        tmp_brain_dir = os.path.join(settings.SHARED_VOLUME_PREFIX, TEMP_DIR_NAME, brain)
        os.makedirs(tmp_brain_dir, exist_ok=True)
        #dump the chunks to a file
        smart_chunks_path = os.path.join(tmp_brain_dir, f'{file_id}_smart_chunks.json')
        with open(smart_chunks_path, 'w',encoding='utf-8') as f:
            json.dump(chunks, f,ensure_ascii=False)
        upload_to_azure_datalake(smart_chunks_path, f"{brain}/{file_id}_smart_chunks.json")
        logger.info(f"Received {len(chunks)} chunks")
        docs = [
            Document(
                page_content=chunk["text"],
                metadata={
                    **{
                        "chunk_order": i + 1,
                        "page": chunk["metadata"]["pageNumber"],
                        "title": chunk["metadata"]["title"].replace("'", " "),
                        "type": "Document",
                    },
                    **metadata,
                },
            )
            for i, chunk in enumerate(chunks)
        ]
        return docs
    except Exception as e:
        logger.info(f"error occured in style_aware_split_pdf_from_azure_datalake: {e}")
        raise e