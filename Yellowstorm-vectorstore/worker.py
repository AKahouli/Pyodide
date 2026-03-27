import json
import os
import secrets
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import fitz
import redis
from PIL import Image, ImageOps, ImageFilter, ImageEnhance
from celery import Celery
from langchain_core.documents import Document

from langcodes import Language

from src.config.settings import get_settings
from src.graph.ingest import generate_pathrag_graph
from src.helpers.classification_helpers import (
    get_directory_id_from_category,
    send_webhook_sync,
    _classify_with_llm_direct,
    _classify_text_with_llm,
)
from src.logger.logging import get_logger
from src.modules.datalake import (
    download_from_azure_datalake,
    upload_to_azure_datalake,
    upload_folder_to_datalake,
    convert_file_to_txt,
    convert_file_to_pdf_and_upload,
    extract_text_from_document,
)
from src.modules.indexing import (
    add_documents,
    style_aware_split_pdf_from_azure_datalake,
    convert_pdf_to_images,
    run_docseg_model,
    merge_boxes,
    find_and_merge_nearest_text,
    extract_sub_image,
    describe_image,
    is_relevant_image,
)
from src.modules.indexing.adding import (
    add_documents_with_classification,
    add_documents_simple,
    verify_qdrant_indexing,
)
from src.modules.indexing.excel_structure_detection import detect_and_classify_excel
from src.modules.indexing.files_classification.multimodal_majority_voting import global_majority_vote_with_weights
from src.modules.indexing.files_classification.similarity_classification import DocumentClassifier
from src.modules.indexing.image_compression import (
    create_compressed_image,
    get_compressed_local_path,
)
from src.modules.indexing.image_index import (
    delete_images_and_tables,
    is_summary,
    remove_summary_pages,
    replace_with_blank_image,
)
from src.modules.indexing.language_detection import detect_language_with_confidence
from src.modules.indexing.splitting import (
    load_and_split_pdf,
    split_documents,
    process_chunks_with_page_separation,
    is_pdf_scanned,
)
from src.modules.delete_tmp import delete_tmp
from src.modules.num_tokens import num_tokens_from_string
from src.redis_store.redis_client import get_redis_url
from src.redis_store.status import DocumentStatusRedis, DocumentStatus
from src.schema.chunk_style import ChunkStyle
from src.schema.simple_classification_webhook import SimpleClassificationPayload
from src.schema.workers.base import (
    WebhookNotificationPayload,
    NotificationStatus,
)
from src.modules.indexing.files_classification.classification_with_llm import classify_document_with_llm_task
from src.schema.fastapi.vectorstores.requests import VectorstoreIndexingError

settings = get_settings()

logger = get_logger(__name__)

# ────────────────────────── constants ──────────────────────────
TEMP_DIR_NAME = "tmp"

celery_app = Celery(
    "index-worker",
    broker=settings.CELERY_BROKER_URL.unicode_string(),
    backend=settings.CELERY_RESULT_BACKEND.unicode_string(),

)
celery_app.conf.task_default_queue = "default"
celery_app.conf.broker_pool_limit = 0
celery_app.conf.task_routes = (
    [
        ("qdrant-index.*", {"queue": "qdrant-index.low-priority"}),
        ("metachatbot-api.*", {"queue": "metachatbot-api-default"}),
        ("data-processing.*", {"queue": "data-processing.batch"}),
        ("conformity.*", {"queue": "conformity.default"}),
        ("dpp-moa.task", {"queue": "dpp-moa.default"}),
        ("classify-indexed-document", {"queue": "data-processing.batch"}),
        ("convert-to-pdf", {"queue": "conversion"}),
        ("*", {"queue": "default"}),
    ],
)


class BaseTaskWithRetry(celery_app.Task):
    autoretry_for = (Exception,)
    retry_kwargs = {'max_retries': 5}
    retry_backoff = 60


######Indexation Worker####################
@celery_app.task(base=BaseTaskWithRetry, name="delete-tmp")
def delete_tmp_task() -> List[str]:
    """
    A celery task for deleting tmp files
    """
    return delete_tmp()


@celery_app.task(base=BaseTaskWithRetry, name="skip-indexation-for-structured-excel")
def skip_indexation_for_structured_excel_task(
    excel_classification: Dict[str, Any],
    temp_folder: str
) -> Dict[str, Any]:
    """
    A dummy task that returns the Excel classification result.

    This task is used when a structured Excel file is detected.
    It returns the classification result so the webhook includes it.
    The task completes successfully, triggering a FINISH webhook.

    Parameters
    ----------
    excel_classification : Dict[str, Any]
        The classification result from detect_and_classify_excel_async
    temp_folder : str
        Temp folder path (for cleanup)

    Returns
    -------
    Dict[str, Any]
        Dictionary with the classification result
    """
    logger.info(f"Structured Excel detected, skipping indexation. Classification: {excel_classification}")

    # Schedule temp folder cleanup
    try:
        delete_tmp.apply_async(args=[temp_folder])
    except Exception as e:
        logger.error(f"Error scheduling temp folder deletion: {e}")

    return {
        "excel_classification": excel_classification,
        "n_tokens":0
    }


@celery_app.on_after_finalize.connect  # type: ignore
def setup_periodic_tasks(sender, **kwargs):
    """
    Setup periodic tasks
    """
    settings = get_settings()
    n_seconds = settings.TMP_DELETE_N_SECONDS

    sender.add_periodic_task(
        n_seconds,
        delete_tmp_task,
        name="periodic-delete-tmp",
    )


@celery_app.task(base=BaseTaskWithRetry, name="split-documents")
def split_documents_task(
        document_dicts: List[Dict[str, Any]],
        chunk_size: int,
        chunk_overlap: int,
        separators: List[str],
        keep_separator: bool,
        keep_order: bool,
        enrich_with_surrounding_chunks: bool = False
) -> List[Dict[str, Any]]:
    """
    A celery task for splitting documents
    """
    if len(document_dicts) == 0:
        return []
    documents = [Document.parse_obj(document) for document in document_dicts]
    result = split_documents(documents, chunk_size, chunk_overlap, separators, keep_separator, keep_order,
                             enrich_with_surrounding_chunks=enrich_with_surrounding_chunks)
    result = [document.dict() for document in result]
    for index, document in enumerate(result):
        document["metadata"]["chunk_order"] = index
    return result


@celery_app.task(base=BaseTaskWithRetry, name="index-in-redis")
def index_in_redis_task(
    tracked_result: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Task that stores document chunks in Redis with BM25 search capability.

    This is the first step in the indexing pipeline. It stores chunks in Redis
    with automatic BM25 indexing and passes the tracked_result to the next task.

    Args:
        tracked_result: List of chunks with page_content and metadata
                       (includes brain_id and external_id in metadata)

    Returns:
        List[Dict[str, Any]]: The tracked_result passed through for the next task
    """
    logger.info(f"Starting Redis BM25 indexing for {len(tracked_result)} chunks")

    if not tracked_result:
        logger.error("❌ tracked_result is empty!")
        raise ValueError("tracked_result cannot be empty")

    # Get brain_id and external_id from metadata
    first_chunk = tracked_result[0]
    metadata = first_chunk.get("metadata", {})

    brain_id = metadata.get("brain_id")
    external_id = metadata.get("external_id")

    if not external_id:
        logger.error(f"❌ external_id not found in tracked_result metadata")
        raise ValueError("external_id is required in tracked_result metadata")

    r = redis.from_url(get_redis_url(), decode_responses=True)

    try:
        r.ping()
    except Exception as e:
        logger.error(f"❌ Redis connection failed: {e}")
        raise

    INDEX_NAME = "idx:chunks"
    KEY_PREFIX = "chunk:"

    # Ensure index exists
    try:
        r.execute_command("FT.INFO", INDEX_NAME)
        logger.info(f"✅ RediSearch index '{INDEX_NAME}' exists")
    except redis.ResponseError:
        logger.info(f"Creating RediSearch index '{INDEX_NAME}'...")
        r.execute_command(
            "FT.CREATE", INDEX_NAME,
            "ON", "JSON",
            "PREFIX", "1", KEY_PREFIX,
            "SCHEMA",
            "$.page_content", "AS", "content", "TEXT",
            "$.metadata.brain_id", "AS", "brain_id", "TAG",
            "$.metadata.external_id", "AS", "external_id", "TAG",
            "$.metadata.source", "AS", "source", "TAG",
            "$.metadata.page", "AS", "page", "NUMERIC",
            "$.metadata.chunk_order", "AS", "chunk_order", "NUMERIC",
            "$.metadata.split_length", "AS", "split_length", "NUMERIC",
            "$.metadata.split_overlap", "AS", "split_overlap", "NUMERIC",
            "$.metadata.language", "AS", "language", "TAG",
        )
        logger.info(f"RediSearch index created")

    # Store chunks in Redis
    indexed_count = 0
    for chunk in tracked_result:
        md = chunk.get("metadata", {})
        chunk_brain_id = md.get("brain_id", brain_id)
        chunk_external_id = md.get("external_id", external_id)
        chunk_order = md.get("chunk_order", 0)

        key = f"{KEY_PREFIX}{chunk_brain_id}:{chunk_external_id}:{chunk_order}"
        r.execute_command("JSON.SET", key, "$", json.dumps(chunk))
        indexed_count += 1

    logger.info(f"✅ Indexed {indexed_count} chunks in Redis BM25")

    # Update status to PENDING after Redis indexing
    if brain_id and external_id:
        redis_store = DocumentStatusRedis(r)
        try:
            redis_store.update_status(
                brain_id=brain_id,
                external_id=external_id,
                status=DocumentStatus.PENDING,
                metrics={"indexed_chunks": indexed_count}
            )
            logger.info(f"✅ Status updated to PENDING for {external_id}")
        except Exception as e:
            logger.warning(f"⚠️Could not update status to PENDING: {e}")

    logger.info(f"✅ Redis BM25 indexing complete! Passing {len(tracked_result)} chunks to next task")

    return tracked_result


@celery_app.task(base=BaseTaskWithRetry, name="download-from-azure-datalake")
def download_from_azure_datalake_task(blob_path: str, temp_folder) -> str:
    """
    A celery task for downloading a file from Azure Data Lake without conversion.
    For non-PDF files, use convert_to_pdf_task separately.
    """
    result = download_from_azure_datalake(blob_path, temp_folder)
    return result


@celery_app.task(base=BaseTaskWithRetry, name="detect-excel-structure")
def detect_excel_structure_task(
    previous_result: str,
    original_file_path: str,
    temp_folder: str
) -> Union[str, Dict[str, Any]]:
    """
    Detect if a downloaded Excel file is structured or unstructured.

    This task should be placed after download_from_azure_datalake_task in the chain.

    - If structured Excel: Returns a dict with classification info (chain ends,
      webhook sent with FINISH status including classification data)
    - If unstructured or not Excel: Returns previous_result (file path) so chain
      continues to next task normally

    Parameters
    ----------
    previous_result : str
        Local file path from download_from_azure_datalake_task
    original_file_path : str
        Original file path in Azure Data Lake
    temp_folder : str
        Temporary folder path

    Returns
    -------
    Union[str, Dict[str, Any]]
        - str (file path) if not structured Excel → chain continues
        - dict with classification if structured Excel → chain ends
    """
    classification_result = detect_and_classify_excel(previous_result)

    is_excel = classification_result.get("is_excel", False)
    is_structured = classification_result.get("is_structured", False)

    if is_excel and is_structured:
        # Structured Excel - end the chain and return classification info
        logger.info(f"Structured Excel detected: {original_file_path}, skipping indexation")
        return {
            "excel_classification": classification_result.get("classification"),
            "original_file_path": original_file_path
        }
    else:
        # Not Excel or unstructured - continue with normal indexation
        if is_excel:
            logger.info(f"Unstructured Excel detected: {original_file_path}, proceeding with indexation")
        return previous_result


@celery_app.task(base=BaseTaskWithRetry, name="convert-to-pdf")
def convert_to_pdf_task(previous_result, original_file_path: str, temp_folder: str) -> str:
    """
    A celery task for converting a non-PDF file to PDF and uploading it to Azure Data Lake.
    This task should only be used for files that are not already PDFs.
    When used in a chain, accepts previous_result as first parameter (ignored).

    Parameters
    ----------
    previous_result : Any
        Result from previous task in chain (ignored)
    original_file_path : str
        The original file path in Azure Data Lake
    temp_folder : str
        Local temporary folder for processing

    Returns
    -------
    str
        Local path to the converted PDF file
    """
    result = convert_file_to_pdf_and_upload(original_file_path, temp_folder)
    return result


@celery_app.task(base=BaseTaskWithRetry, name="convert-pdf-to-txt")
def convert_pdf_to_txt_task(blob_path: str) -> str:
    """
    A celery task for downloading a file from Azure Data Lake
    """

    result = convert_file_to_txt(blob_path)
    return result


@celery_app.task(base=BaseTaskWithRetry, name="style-aware-split-pdf-from-azure-datalake")
def style_aware_split_pdf_from_azure_datalake_task(
        blob_path: str, chunk_style_dicts: List[Dict[str, Any]], metadata: Dict[str, Any], correlation_id: str) -> List[
    Dict[str, Any]]:
    """
    A celery task for style-aware splitting a pdf from Azure Data Lake
    """
    chunk_styles = [ChunkStyle(**chunk_style) for chunk_style in chunk_style_dicts]
    result = style_aware_split_pdf_from_azure_datalake(blob_path, chunk_styles, metadata, upload_to_azure_datalake,
                                                       correlation_id=correlation_id)
    return [document.dict() for document in result]


@celery_app.task(base=BaseTaskWithRetry, name="upload-pdf-to-datalake")
def upload_pdf_to_azure_datalake_task(no_img_pdf: str, file_path: str) -> str:
    directory, file_name = os.path.split(file_path)
    base_name, ext = os.path.splitext(file_name)
    new_file_name = f"{base_name}_noimg{ext}"
    destination_path = os.path.join(directory, new_file_name)
    destination_path = str(destination_path).replace("\\", "/")
    upload_to_azure_datalake(no_img_pdf, destination_path)
    return destination_path


@celery_app.task(base=BaseTaskWithRetry, name="generation-graph")
def generation_graph_task(file_path, graph_directory, embedding_dimension, datalake_directory,
                          user_id="unknown") -> Dict:
    """
    A celery task for generation graph from a file in Azure Data Lake
    """
    graph = generate_pathrag_graph(file_path, graph_directory, embedding_dimension, user_id=user_id)
    result = upload_folder_to_datalake(datalake_directory, graph)
    return {"html_path": result + "/graph.html",
            "graphml_path": result + "graph_chunk_entity_relation.graphml",
            "n_tokens": 0}


# Image feature tasks
####################################################################################################
@celery_app.task(base=BaseTaskWithRetry, name="upload-to-azure-datalake")
def upload_to_azure_datalake_task(t: Tuple[dict[int, List[str]], str], destination_path: str) -> Tuple[
    dict[int, List[str]], str]:
    """
    A celery task for duploading a file to Azure Data Lake
    """
    sub_img = t[0]
    file_path = t[1]
    for index, res in sub_img.items():
        for img in res:
            name = img.split('/')[-1]
            upload_to_azure_datalake(img, destination_path + '/' + name)
    return sub_img, file_path


@celery_app.task(base=BaseTaskWithRetry, name="convert-pdf-to-images")
def convert_pdf_to_images_task(file_path: str, image: bool) -> Union[Tuple[List[str], str], str]:
    """
    A Celery task that converts a PDF to images, checks if the first 10 images are summaries,
    replaces summary images with blank images, and updates the PDF with blank pages.
    """
    dir_path = os.path.dirname(file_path)
    if file_path.lower().endswith(('.xls', '.xlsx')):
        return file_path
    else:
        # Proceed with PDF to image conversion
        image_paths = convert_pdf_to_images(file_path, dir_path, image=image)
    summary_pages = [idx for idx, image_path in enumerate(image_paths[:10]) if is_summary(image_path)]

    for idx in summary_pages:
        replace_with_blank_image(image_paths[idx])

    if summary_pages:
        new_pdf_path = remove_summary_pages(file_path, summary_pages)
    else:
        new_pdf_path = file_path  # No changes if no summary pages

    if image:
        return image_paths, new_pdf_path  # Return all image paths (including replaced blanks)
    else:
        return new_pdf_path


@celery_app.task(base=BaseTaskWithRetry, name="run-image-through-yolo")
def run_image_through_yolo(
        t: Tuple[List[str], str]
) -> Tuple[List[List[dict]], str]:
    """
    A celery task for running the images through yolo
    """
    imges_paths = t[0]
    file_path = t[1]
    result = run_docseg_model(imges_paths)
    return result, file_path


@celery_app.task(base=BaseTaskWithRetry, name="delete-images-and-tables")
def delete_images_and_tables_task(t: Tuple[List[List[dict]], str], temp_folder: str) -> str:
    yolo_result = t[0]
    file_path = t[1]
    result = delete_images_and_tables(file_path, yolo_result, temp_folder)
    return result

@celery_app.task(base=BaseTaskWithRetry, name="post-process-segmentation-results")
def post_process_segmentation_results(
        t: Tuple[List[List[dict]], str]
) -> Tuple[dict[int, List[dict]], str]:
    """
    Post-process segmentation results from PP-DocLayout-L
    """

    seg_results = t[0]
    file_path = t[1]

    # PP-DocLayout-L categories
    TEXT_CLASSES = {
        "text",
        "document_title",
        "paragraph_title",
        "abstract",
        "references",
        "footnotes",
        "aside_text",
        "table_of_contents",
    }

    IMAGE_CLASSES = {
        "image",
        "figure",
        "table",
        "header_image",
        "footer_image",
    }

    d = {}

    for index, res in enumerate(seg_results):

        result = merge_boxes(res)

        text_elements = [
            elem for elem in result
            if elem["name"].lower().replace("-", "_") in TEXT_CLASSES
        ]

        image_elements = [
            elem for elem in result
            if elem["name"].lower().replace("-", "_") in IMAGE_CLASSES
        ]

        # sort vertically
        image_elements.sort(key=lambda x: x["y1"])
        text_elements.sort(key=lambda x: x["y1"])

        # attach captions / nearby text
        updated_image_elements = find_and_merge_nearest_text(
            image_elements,
            text_elements,
            max_aspect_ratio=5
        )

        updated_image_elements = merge_boxes(updated_image_elements)

        if updated_image_elements:
            d[index + 1] = updated_image_elements

    return d, file_path


@celery_app.task(base=BaseTaskWithRetry, name="extract-sub-images")
def extract_sub_images(
        t: Tuple[dict[int, List[dict]], str]
) -> Tuple[dict[int, List[str]], str]:
    """
    A celery task for extracting sub images
    """
    post_process_res = t[0]
    file_path = t[1]

    # Extract the filename
    filename = os.path.basename(file_path)

    file_id = os.path.splitext(filename)[0]

    dir_path = os.path.dirname(file_path)

    d = {}
    for index, res in post_process_res.items():
        result = extract_sub_image(dir_path + f'/page_{index}.png', res, index, dir_path, file_id)
        d[index] = result

    return d, file_path


@celery_app.task(base=BaseTaskWithRetry, name="filter-images")
def filter_images(t: Tuple[Dict[int, List[str]], str]) -> Tuple[Dict[int, List[str]], str]:
    image_dict = t[0]
    file_path = t[1]

    def filter_key(key: int) -> Tuple[int, List[str]]:
        valid_paths = [path for path in image_dict[key] if is_relevant_image(path)]
        return key, valid_paths

    # Using ThreadPoolExecutor to parallelize the task
    with ThreadPoolExecutor(max_workers=settings.NUMBER_OF_IMAGE_WORKERS) as executor:
        # Mapping the keys to the function in parallel
        results = list(executor.map(filter_key, list(image_dict.keys())))

    # Collecting the results
    new_image_dict = {key: paths for key, paths in results if paths}

    return new_image_dict, file_path


@celery_app.task(base=BaseTaskWithRetry, name="compress-sub-images")
def compress_sub_images(t: Tuple[Dict[int, List[str]], str]) -> Dict[str, Any]:
    """
    Create compressed versions for extracted sub-images.
    Returns a bundle containing original and compressed image maps.
    """
    image_dict = t[0]
    file_path = t[1]

    compressed_dict: Dict[int, List[str]] = {}
    for index, res in image_dict.items():
        for img in res:
            compressed = create_compressed_image(img)
            if compressed:
                if index not in compressed_dict:
                    compressed_dict[index] = []
                compressed_dict[index].append(compressed)

    return {"original": image_dict, "compressed": compressed_dict, "file_path": file_path}


@celery_app.task(base=BaseTaskWithRetry, name="upload-original-images")
def upload_original_images_task(bundle: Dict[str, Any], destination_path: str) -> Dict[str, Any]:
    """
    Upload original sub-images to Azure Data Lake.
    Returns the bundle unchanged for downstream tasks.
    """
    image_dict = bundle.get("original", {})
    for index, res in image_dict.items():
        for img in res:
            name = os.path.basename(img)
            upload_to_azure_datalake(img, destination_path + '/' + name)
    return bundle


@celery_app.task(base=BaseTaskWithRetry, name="upload-compressed-images")
def upload_compressed_images_task(bundle: Dict[str, Any], destination_path: str) -> Tuple[
    Dict[int, List[str]], str]:
    """
    Upload compressed sub-images to Azure Data Lake.
    Returns the original image dict and file path for downstream tasks.
    """
    image_dict = bundle.get("compressed", {})
    file_path = bundle.get("file_path", "")
    for index, res in image_dict.items():
        for img in res:
            name = os.path.basename(img)
            upload_to_azure_datalake(img, destination_path + '/' + name)
    return bundle.get("original", {}), file_path


def process_image(img, datalake_dir, language, user_id="unknown"):
    """
    Process an image and extract its description and dimensions.
    Uses context manager to ensure proper resource cleanup.
    """
    datalake_path = img.split('/')[-1]
    compressed_local_path = get_compressed_local_path(img)
    image_path_for_description = compressed_local_path if os.path.exists(compressed_local_path) else img
    result = describe_image(image_path_for_description, language, user_id)
    # Use context manager to ensure image is properly closed
    try:
        with Image.open(img) as image:
            width, height = image.size
        return result, datalake_dir + "/" + datalake_path, {'width': width, 'height': height}
    except Exception as e:
        logger.error(f"Error processing image {img}: {e}")
        # Return None values to indicate failure without crashing the thread
        return None, datalake_dir + "/" + datalake_path, {'width': 0, 'height': 0}


@celery_app.task(base=BaseTaskWithRetry, name="clear-tmp")
def delete_temp_folder(temp_folder: str):
    """Delete the temporary folder."""
    if os.path.exists(temp_folder):
        shutil.rmtree(temp_folder)
        return f"Deleted folder: {temp_folder}"
    else:
        return f"Folder {temp_folder} does not exist."


@celery_app.task(base=BaseTaskWithRetry, name="get-image-description")
def get_image_description(t: Tuple[dict[int, List[str]], str], datalake_dir: str, metadata: Dict[str, Any],
                          user_id: Optional[str] = None) -> Tuple[
    Dict[int, List[Tuple[str, str, dict]]], str]:
    """
    A celery task for getting image description from the extracted sub images
    """
    try:

        language = Language.make(language=metadata['language']).display_name()
    except:
        language = metadata['language']
    sub_images = t[0]
    file_path = t[1]
    d = {}

    with ThreadPoolExecutor(max_workers=settings.NUMBER_OF_IMAGE_WORKERS) as executor:
        futures = {executor.submit(process_image, img, datalake_dir, language, user_id): (index, img) for index, res in
                   sub_images.items()
                   for img in res}

        for future in as_completed(futures):
            index, img = futures[future]
            try:
                result, path, size = future.result()
                # Skip failed image processing (where result is None)
                if result is not None:
                    if index not in d:
                        d[index] = []
                    d[index].append((result, path, size))
                else:
                    logger.warning(f"Skipping failed image processing for {img}")
            except Exception as e:
                logger.exception(f"Exception occurred for image {img}: {e}")
                # Continue processing other images instead of failing the entire task

    return d, file_path


@celery_app.task(base=BaseTaskWithRetry, name="create-document-object")
def create_document_object(
        t: Tuple[Dict[int, List[Tuple[str, str]]], str], metadata: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    A celery task for creating document object from the extracted sub images description
    """
    sub_imges_description = t[0]
    file_path = t[1]
    l = []
    for index, desc in sub_imges_description.items():
        for d in desc:
            image_path = d[1]
            compressed_path = None
            if image_path:
                base_name = os.path.basename(image_path)
                name, _ = os.path.splitext(base_name)
                compressed_name = f"{name}_compressed.jpeg"
                if "/" in image_path:
                    dir_path = image_path.rsplit("/", 1)[0]
                    compressed_path = f"{dir_path}/{compressed_name}"
                elif "\\" in image_path:
                    dir_path = image_path.rsplit("\\", 1)[0]
                    compressed_path = f"{dir_path}/{compressed_name}"
                else:
                    compressed_path = compressed_name

            metadata_obj = {
                'source': file_path,
                "page": index,
                'type': 'image',
                'image_path': image_path,
                'aspect_ratio': d[2],
                **metadata
            }
            if compressed_path:
                metadata_obj['image_compressed'] = compressed_path

            l.append({
                'page_content': d[0],
                'metadata': metadata_obj
            })
    return l


@celery_app.task(base=BaseTaskWithRetry, name="get-single-image-description")
def get_single_image_description_task(
        local_image_path: str,
        original_file_path: str,
        metadata: Dict[str, Any],
        user_id: Optional[str] = None
) -> Tuple[str, str, str, Dict[str, int]]:
    """
    A celery task for getting a description of a single image file.

    This task is used for direct image file uploads (jpg, png, etc.) that bypass
    PDF conversion. It describes the image using vision AI, saves a compressed (50% resized enhanced)
    version for token efficiency, uploads it to datalake, and gets image dimensions.

    Parameters
    ----------
    local_image_path : str
        Local path to the downloaded image file
    original_file_path : str
        Original file path in Azure Data Lake
    metadata : Dict[str, Any]
        Metadata containing the language code for description
    user_id : Optional[str]
        User ID for tracking

    Returns
    -------
    Tuple[str, str, str, Dict[str, int]]
        (description, datalake_path, compressed_datalake_path, dimensions) where:
        - description: Image description from vision AI
        - datalake_path: Original filename (for reference)
        - compressed_datalake_path: Path to the compressed (50% enhanced) image in Azure Data Lake
        - dimensions: Dict with 'width' and 'height' of the image
    """
    try:
        language = Language.make(language=metadata['language']).display_name()
    except:
        language = metadata.get('language', 'English')

    # Get image dimensions and create compressed (50% resized enhanced) version
    dimensions = {'width': 0, 'height': 0}
    compressed_local_path = None
    compressed_datalake_path = None

    try:
        with Image.open(local_image_path) as image:
            original_width, original_height = image.size
            dimensions = {'width': original_width, 'height': original_height}

            # Calculate 50% dimensions
            new_width = max(1, int(original_width * 0.5))
            new_height = max(1, int(original_height * 0.5))

            # Convert to RGB if necessary (for PNG with alpha channel, etc.)
            if image.mode in ('RGBA', 'LA', 'P'):
                # Create white background for transparent images
                rgb_image = Image.new('RGB', image.size, (255, 255, 255))
                if image.mode == 'P':
                    image = image.convert('RGBA')
                rgb_image.paste(image, mask=image.split()[-1] if image.mode in ('RGBA', 'LA') else None)
                image = rgb_image
            elif image.mode != 'RGB':
                image = image.convert('RGB')

            # STEP 1: Mild autocontrast before resizing (helps thin text)
            image = ImageOps.autocontrast(image, cutoff=1)

            # STEP 2: Resize using high-quality LANCZOS resampling to 50%
            resized_image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)

            # STEP 3: Post-resize sharpening (key for text readability!)
            resized_image = resized_image.filter(ImageFilter.UnsharpMask(radius=1.5, percent=180, threshold=3))

            # STEP 4: Slight contrast boost
            resized_image = ImageEnhance.Contrast(resized_image).enhance(1.15)

            # Create compressed filename
            base_name = os.path.basename(local_image_path)
            name, _ = os.path.splitext(base_name)
            compressed_filename = f"{name}_compressed.jpeg"
            compressed_local_path = os.path.join(os.path.dirname(local_image_path), compressed_filename)

            # Save as JPEG with quality=85
            resized_image.save(compressed_local_path, format='JPEG', quality=85, optimize=True)
            logger.info(f"Created compressed (50% enhanced) JPEG: {compressed_local_path} - {original_width}x{original_height} -> {new_width}x{new_height}")

            # Upload to Azure Data Lake with same directory structure as original
            datalake_directory = "/".join(original_file_path.split("/")[:-1])
            compressed_datalake_path = f"{datalake_directory}/{compressed_filename}" if datalake_directory else compressed_filename
            upload_to_azure_datalake(compressed_local_path, compressed_datalake_path)
            logger.info(f"Uploaded compressed JPEG to datalake: {compressed_datalake_path}")

    except Exception as e:
        logger.error(f"Error processing compressed JPEG for {local_image_path}: {e}")

    # Get image description using compressed version for smaller API payload
    # Fall back to original if compression failed
    image_path_for_description = compressed_local_path or local_image_path
    description = describe_image(image_path_for_description, language, user_id or "unknown")

    # datalake_path will be the original filename for reference
    datalake_path = os.path.basename(local_image_path)

    return description, datalake_path, compressed_datalake_path, dimensions


@celery_app.task(base=BaseTaskWithRetry, name="create-single-image-document")
def create_single_image_document_task(
        previous_result: Tuple[str, str, str, Dict[str, int]],
        original_file_path: str,
        metadata: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """
    A celery task for creating a document object from a single image description.

    This task creates a Langchain Document object compatible with the add_documents_task.

    Parameters
    ----------
    previous_result : Tuple[str, str, str, Dict[str, int]]
        Result from get_single_image_description_task containing:
        - description: Image description from vision AI
        - datalake_path: Original filename (for reference)
        - compressed_datalake_path: Path to the compressed (50% enhanced) image in Azure Data Lake
        - dimensions: Dict with 'width' and 'height' of the image
    original_file_path : str
        Original file path in Azure Data Lake
    metadata : Dict[str, Any]
        Additional metadata to attach to the document

    Returns
    -------
    List[Dict[str, Any]]
        List containing a single document dict compatible with add_documents_task
    """
    description, datalake_path, compressed_datalake_path, dimensions = previous_result

    document_metadata = {
        'source': original_file_path,
        'type': 'image',
        'image_path': datalake_path,
        'aspect_ratio': dimensions,
        **metadata
    }

    # Add source_compressed only if the compressed version was successfully uploaded
    if compressed_datalake_path:
        document_metadata['image_compressed'] = compressed_datalake_path

    return [{
        'page_content': description,
        'metadata': document_metadata
    }]


# Qdrant tasks
####################################################################################################


# new version
@celery_app.task(
    base=BaseTaskWithRetry, name="qdrant-index.add-documents-with-classification"
)
def add_documents_with_classification_task(
        language_detection_result,
        collection_name: str,
        directories: List[str],
        external_id: Optional[str],
        user_id: Optional[str] = "unknown",
        classification_enabled: bool = False,
        include_images: bool = False,
        webhook_url: Optional[str] = None,
        webhook_metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Tâche Celery pour l'ajout de documents avec classification
    """
    # Handle both legacy format (direct document list) and new format (language detection result)
    if isinstance(language_detection_result, dict) and 'chunks' in language_detection_result:
        # New format: result from language_detect_task
        document_dicts = language_detection_result['chunks']
        detected_language = language_detection_result.get('detected_language', 'unknown')
        detection_confidence = language_detection_result.get('detection_confidence', 0.0)
    else:
        # Legacy format: direct document list
        document_dicts = language_detection_result
        detected_language = 'unknown'
        detection_confidence = 0.0

    if len(document_dicts) == 0:
        return {
            "n_tokens": 0,
            "ids": [],
            "classifications": {},
            "detected_language": detected_language,
            "detection_confidence": detection_confidence
        }
    documents = []

    for doc in document_dicts:
        if "chunks" in doc:
            # Cas 1 : le document contient déjà des chunks
            for chunk in doc["chunks"]:
                documents.append(
                    Document(
                        page_content=chunk.get("page_content", ""),
                        metadata=chunk.get("metadata", doc.get("metadata", {})),
                    )
                )
        else:
            # Cas 2 : le document est brut (pas de chunks)
            documents.append(
                Document(
                    page_content=doc.get("page_content", ""),
                    metadata=doc.get("metadata", {}),
                )
            )
    # Calculate total tokens for the entire document and inject into each chunk's metadata
    total_tokens = sum(num_tokens_from_string(doc.page_content) for doc in documents)
    for doc in documents:
        doc.metadata["total_tokens"] = total_tokens

    result = add_documents_with_classification(
        index_name=collection_name,
        documents=documents,
        directories=directories,
        external_id=external_id,
        user_id=user_id,
        classification_enabled=classification_enabled,
        include_images=include_images,
    )

    if webhook_url and webhook_metadata and classification_enabled:
        # Extract classification details
        classifications = result.get("classifications", {})
        predicted_category = classifications.get("predicted_category", "Unknown")
        final_confidence = classifications.get("final_confidence", 0.0)
        classification_source = classifications.get("classification_source", "llm_new")

        # Check if it's a new category based on classification_source
        is_new_category = classification_source == "llm_new"
        category_id = classifications.get("category_id")

        webhook_payload = WebhookNotificationPayload(
            event_type="file_classification_task",
            task_id=webhook_metadata.get("task_id"),
            detected_category=predicted_category,
            category_confidence=final_confidence,
            is_new_category=is_new_category,
            category_source=classification_source,
            category_id=category_id,
            metadata=webhook_metadata.copy()
        ).model_dump()

        # Log the webhook payload before sending
        logger.info(f"🚀 WEBHOOK PAYLOAD - add_documents_with_classification_task")
        logger.info(f"Webhook URL: {webhook_url}")
        logger.info(f"Webhook Payload: {webhook_payload}")
        logger.info(f"Detected Category: {webhook_payload.get('detected_category')}")
        logger.info(f"Category Confidence: {webhook_payload.get('category_confidence')}")
        logger.info(f"Task ID: {webhook_payload.get('task_id')}")
        logger.info(f"Event Type: {webhook_payload.get('event_type')}")

        send_webhook_sync(webhook_url, webhook_payload)

    result.update(
        {
            "detected_language": detected_language,
            "detection_confidence": detection_confidence,
        }
    )
    return result


@celery_app.task(base=BaseTaskWithRetry, name="verify-qdrant-and-delete-from-redis")
def verify_qdrant_and_delete_from_redis(
    qdrant_index_result_or_results,
    brain_id: str,
    external_id: str,
    collection_name: str,
) -> Dict[str, Any]:
    """
    Celery task that verifies Qdrant indexing, updates Redis status, and deletes BM25 chunks.

    This task can work in two modes:
    1. Single result mode: Called after a single add_documents_task
    2. Chord callback mode: Called as a chord callback after multiple add_documents_task calls
       (e.g., from img_group and text_group in image-enabled pipeline)

    In chord callback mode, it receives results from both groups and verifies BOTH indexations.

    Args:
        qdrant_index_result_or_results: Can be either:
            - Single result from add_documents_task (dict with ids, n_tokens, etc.)
            - List of results from chord callback [img_result, text_result]
        brain_id: Brain ID for the document
        external_id: External document ID
        collection_name: Name of the Qdrant collection

    Returns:
        Dict with verification results and deletion count
    """
    # Wrap everything in try/except to ensure status is updated even on crashes
    try:
        r = redis.from_url(get_redis_url(), decode_responses=True)
        redis_store = DocumentStatusRedis(r)

        # Detect if this is a chord callback (list of results) or single result
        if isinstance(qdrant_index_result_or_results, list) and len(qdrant_index_result_or_results) > 1:
            # Chord callback mode: Multiple results from img_group and text_group
            logger.info(f"=== IMAGE-ENABLED PIPELINE VERIFICATION ===")
            logger.info(f"Brain: {brain_id}, External ID: {external_id}")

            # Extract results from both groups
            img_qdrant_result = qdrant_index_result_or_results[0]
            text_qdrant_result = qdrant_index_result_or_results[1]

            img_ids = img_qdrant_result.get("ids", [])
            text_ids = text_qdrant_result.get("ids", [])
            img_n_tokens = img_qdrant_result.get("n_tokens", 0)
            text_n_tokens = text_qdrant_result.get("n_tokens", 0)

            total_ids_count = len(img_ids) + len(text_ids)
            total_n_tokens = img_n_tokens + text_n_tokens

            logger.info(f"Image documents indexed: {len(img_ids)} ({img_n_tokens} tokens)")
            logger.info(f"Text documents indexed: {len(text_ids)} ({text_n_tokens} tokens)")
            logger.info(f"Total: {total_ids_count} documents ({total_n_tokens} tokens)")

            # Verify BOTH indexations in Qdrant
            img_verified = verify_qdrant_indexing(
                collection_name=collection_name,
                external_id=external_id,
                expected_count=len(img_ids),
                max_retries=3,
                retry_delay=2
            ) if img_ids else True  # If no images, consider verified

            text_verified = verify_qdrant_indexing(
                collection_name=collection_name,
                external_id=external_id,
                expected_count=len(text_ids),
                max_retries=1,
                retry_delay=2
            ) if text_ids else True  # If no text, consider verified

            both_verified = img_verified and text_verified

            if both_verified:
                # Update status to COMPLETED
                redis_store.update_status(
                    brain_id=brain_id,
                    external_id=external_id,
                    status=DocumentStatus.COMPLETED,
                    metrics={
                        "vectorstore_name": collection_name,
                        "indexed_img_docs": len(img_ids),
                        "indexed_text_docs": len(text_ids),
                        "indexed_total_docs": total_ids_count,
                        "n_tokens": total_n_tokens,
                        "verified": True
                    }
                )
                logger.info(f"✅ BOTH indexations verified - Updated status to COMPLETED for {external_id}")

                # Delete chunks from Redis only after successful verification
                deleted_count = redis_store.delete_chunks(brain_id=brain_id, external_id=external_id)
                logger.info(f"✅ Redis cleanup complete: deleted {deleted_count} chunks for {external_id}")
            else:
                # Update status to FAILED - do NOT delete chunks so they can be retried
                redis_store.update_status(
                    brain_id=brain_id,
                    external_id=external_id,
                    status=DocumentStatus.FAILED,
                    metrics={
                        "error": f"Qdrant verification failed - img_verified: {img_verified}, text_verified: {text_verified}",
                        "vectorstore_name": collection_name,
                        "img_uploaded_count": len(img_ids),
                        "text_uploaded_count": len(text_ids)
                    }
                )
                logger.error(
                    f"❌ Qdrant verification failed - img_verified: {img_verified}, text_verified: {text_verified}")
                deleted_count = 0

            # Return combined results
            return {
                "verified": both_verified,
                "img_verified": img_verified,
                "text_verified": text_verified,
                "chunks_deleted": deleted_count,
                "brain_id": brain_id,
                "external_id": external_id,
                "collection_name": collection_name,
                "n_tokens": total_n_tokens,
                "ids": img_ids + text_ids,  # Combined IDs
                "img_ids": img_ids,
                "text_ids": text_ids,
            }
        else:
            # Single result mode (original behavior done in text only)
            logger.info(f"🔍 Verifying Qdrant & cleaning Redis for {external_id} in brain {brain_id}")

            qdrant_index_result = qdrant_index_result_or_results if isinstance(qdrant_index_result_or_results, dict) else {}

            # Get expected count from qdrant_index_result
            expected_count = len(qdrant_index_result.get("ids", []))
            n_tokens = qdrant_index_result.get("n_tokens", 0)

            # Verify documents are actually indexed in Qdrant
            is_verified = verify_qdrant_indexing(
                collection_name=collection_name,
                external_id=external_id,
                expected_count=expected_count,
                max_retries=3,
                retry_delay=2
            )

            if is_verified:
                # Update status to COMPLETED
                redis_store.update_status(
                    brain_id=brain_id,
                    external_id=external_id,
                    status=DocumentStatus.COMPLETED,
                    metrics={
                        "vectorstore_name": collection_name,
                        "indexed_docs": expected_count,
                        "n_tokens": n_tokens,
                        "verified": True
                    }
                )
                logger.info(f"✅ Updated status to COMPLETED for {external_id} in brain {brain_id}")

                # Delete chunks from Redis only after successful verification
                deleted_count = redis_store.delete_chunks(brain_id=brain_id, external_id=external_id)
                logger.info(f"✅ Redis cleanup complete: deleted {deleted_count} chunks for {external_id}")
            else:
                # Update status to FAILED - do NOT delete chunks so they can be retried
                redis_store.update_status(
                    brain_id=brain_id,
                    external_id=external_id,
                    status=DocumentStatus.FAILED,
                    metrics={
                        "error": "Qdrant verification failed - documents not found after indexing",
                        "vectorstore_name": collection_name,
                        "uploaded_count": expected_count
                    }
                )
                logger.error(
                    f"❌ Qdrant verification failed for {external_id} in brain {brain_id} - chunks NOT deleted")
                deleted_count = 0

            # Return data for webhook to update MongoDB
            # Must include n_tokens and ids for BackChatBot's handleSuccessfulIndexation
            return {
                "verified": is_verified,
                "chunks_deleted": deleted_count,
                "brain_id": brain_id,
                "external_id": external_id,
                "collection_name": collection_name,
                "n_tokens": n_tokens,  # Required for MongoDB indexing_token
                "ids": qdrant_index_result.get("ids", [])  # Required for webhook
            }

    except Exception as e:
        # Don't mark as FAILED for Redis connection issues - just log and retry
        # Status should only change to COMPLETED/FAILED based on Qdrant indexing results
        logger.error(f"❌ Exception in verify_qdrant_and_delete_from_redis for {external_id}: {e}")
        logger.error(f"   Task will be retried. Status will be updated when Redis is available.")

        # Re-raise the exception so Celery retries the task (BaseTaskWithRetry)
        # Status stays at PENDING until successful verification
        raise


@celery_app.task(
    base=BaseTaskWithRetry, name="qdrant-index.add-documents"
)
def add_documents_task(
        language_detection_result,
        collection_name: str,
        external_id: Optional[str],
        user_id: Optional[str] = "unknown",
        include_images: bool = False,
        webhook_url: Optional[str] = None,
        webhook_metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Celery task for adding documents to vector store without classification.

    Includes error handling to update Redis status to FAILED when Qdrant indexing fails.
    This prevents documents from getting stuck in PENDING status (prev bug)
    """
    # Extract brain_id from documents for status updates
    brain_id = None

    try:
        # Handle both legacy format (direct document list) and new format (language detection result)
        if isinstance(language_detection_result, dict) and 'chunks' in language_detection_result:
            # New format: result from language_detect_task
            document_dicts = language_detection_result['chunks']
            detected_language = language_detection_result.get('detected_language', 'unknown')
            detection_confidence = language_detection_result.get('detection_confidence', 0.0)
        else:
            # Legacy format: direct document list
            document_dicts = language_detection_result
            detected_language = 'unknown'
            detection_confidence = 0.0

        if len(document_dicts) == 0:
            return {
                "n_tokens": 0,
                "ids": [],
                "detected_language": detected_language,
                "detection_confidence": detection_confidence
            }
        documents = []

        for doc in document_dicts:
            if "chunks" in doc:
                # Cas 1 : le document contient déjà des chunks
                for chunk in doc["chunks"]:
                    metadata = chunk.get("metadata", doc.get("metadata", {}))
                    # Extract brain_id from metadata for status updates
                    if not brain_id and metadata.get("brain_id"):
                        brain_id = metadata.get("brain_id")
                    documents.append(
                        Document(
                            page_content=chunk.get("page_content", ""),
                            metadata=metadata,
                        )
                    )
            else:
                # Cas 2 : le document est brut (pas de chunks)
                metadata = doc.get("metadata", {})
                # Extract brain_id from metadata for status updates
                if not brain_id and metadata.get("brain_id"):
                    brain_id = metadata.get("brain_id")
                documents.append(
                    Document(
                        page_content=doc.get("page_content", ""),
                        metadata=metadata,
                    )
                )

        # Calculate total tokens for the entire document and inject into each chunk's metadata
        total_tokens = sum(num_tokens_from_string(doc.page_content) for doc in documents)
        for doc in documents:
            doc.metadata["total_tokens"] = total_tokens

        result = add_documents_simple(
            index_name=collection_name,
            documents=documents,
            external_id=external_id,
            user_id=user_id,
            include_images=include_images,
        )

        result.update(
            {
                "detected_language": detected_language,
                "detection_confidence": detection_confidence,
            }
        )
        return result

    except Exception as e:
        # Check if this is a Redis connection error
        error_msg = str(e).lower()
        is_redis_error = any(keyword in error_msg for keyword in [
            "redis", "connection", "timeout connecting to redis",
            "redis connection", "errno 111"
        ])

        if is_redis_error:
            # Redis connection issue - just log and retry
            logger.error(f"❌ Redis connection error in add_documents_task for {external_id}: {e}")
            logger.error(f"   Task will be retried. Status will be updated when Redis is available.")
            # Re-raise for retry - status stays at PENDING
            raise
        else:
            # Qdrant indexing error - FAILED
            logger.error(f"❌ Qdrant indexing failed for {external_id}: {e}")

            if brain_id and external_id:
                try:
                    r = redis.from_url(get_redis_url(), decode_responses=True)
                    redis_store = DocumentStatusRedis(r)

                    # Determine error type
                    error_code = "QDRANT_INDEXING_ERROR"

                    if "quota" in error_msg or "limit" in error_msg:
                        error_code = "QDRANT_QUOTA_EXCEEDED"
                    elif "timeout" in error_msg and "qdrant" in error_msg:
                        error_code = "QDRANT_TIMEOUT"
                    elif "connection" in error_msg and "qdrant" in error_msg:
                        error_code = "QDRANT_CONNECTION_ERROR"

                    redis_store.update_status(
                        brain_id=brain_id,
                        external_id=external_id,
                        status=DocumentStatus.FAILED,
                        metrics={
                            "error": f"Qdrant indexing failed: {str(e)}",
                            "error_code": error_code,
                            "error_type": type(e).__name__,
                            "vectorstore_name": collection_name,
                            "indexing_operation": "add_documents"
                        },
                        force=True  # Force update even if transition seems invalid
                    )
                    logger.info(f"✅ Updated status to FAILED for {external_id} (Qdrant indexing error)")
                except Exception as redis_error:
                    logger.error(f"❌ Could not update status to FAILED for {external_id}: {redis_error}")

            # Re-raise the exception so Celery handles retries properly
            raise


@celery_app.task
def majority_voting_task(results, webhook_url: Optional[str] = None, task_metadata: Optional[Dict[str, Any]] = None):
    """
    Tâche de majority voting qui reçoit les résultats des tâches parallèles

    Args:
        results: Liste contenant les résultats de img_group et text_group
                [résultat_img_group, résultat_text_group]
    """
    img_result, text_result = results

    # Utiliser la nouvelle classe

    final_classification, processing_summary = global_majority_vote_with_weights(
        img_result, text_result
    )
    # Send webhook notification if URL is provided
    if webhook_url and task_metadata:
        webhook_payload = WebhookNotificationPayload(
            event_type="file_classification_task",
            task_id=task_metadata.get("task_id"),
            detected_category=processing_summary.get("classification_result"),
            category_confidence=processing_summary.get("final_confidence"),
            metadata=task_metadata.copy(),
        ).model_dump()
        send_webhook_sync(webhook_url, webhook_payload)

    return {
        "final_classification": final_classification,
        "processing_summary": processing_summary,
        "document_id": processing_summary.get("document_processed"),
    }


@celery_app.task(base=BaseTaskWithRetry,
                 name="load-and-split-pdf"
                 )
def load_split_document_task(file_path: str, metadata: Dict[str, Any], chunk_size: int, chunk_overlap: int,
                             sheet_name: Optional[str] = None, brain_id: Optional[str] = None,
                             external_id: Optional[str] = None) -> List[
    Dict[str, Any]]:
    # Add brain_id and external_id to metadata if provided
    if brain_id:
        metadata["brain_id"] = brain_id
    if external_id:
        metadata["external_id"] = external_id

    result = load_and_split_pdf(file_path, metadata, chunk_size, chunk_overlap, sheet_name)
    is_scanned = is_pdf_scanned(file_path)
    tracked_result = process_chunks_with_page_separation(result, is_scanned)
    return tracked_result


@celery_app.task(base=BaseTaskWithRetry, name="language-detect-task")
def language_detect_task(chunks: List[Dict[str, Any]], webhook_url: Optional[str] = None,
                         task_metadata: Optional[Dict[str, Any]] = None, file_path: Optional[str] = None) -> Dict[
    str, Any]:
    """
    A celery task for detecting language in document chunks using FastText.
    When webhook_url is None, uses the first 10 pages of the PDF file for detection.
    When webhook_url is provided, uses random sampling with confidence threshold to determine document language.

    Args:
        chunks: List of document chunks with 'page_content' and 'metadata' keys
        webhook_url: Optional webhook URL to send language detection results
        task_metadata: Optional metadata for the task (for webhook payload)
        file_path: Optional path to the PDF file for direct page extraction (used when webhook_url is None)

    Returns:
        Dict containing:
        - 'chunks': List of chunks with detected language added to metadata['language']
        - 'detected_language': The detected language code
        - 'detection_confidence': The confidence score of the detection
    """
    if not chunks:
        return {
            'chunks': [],
            'detected_language': 'unknown',
            'detection_confidence': 0.0
        }

    logger.info(f"Processing {len(chunks)} chunks for language detection")

    detected_language = "unknown"
    confidence = 0.0

    # If webhook_url is None, use first 10 pages of PDF file directly
    if webhook_url is None and file_path:
        try:
            logger.info(f"Using direct PDF extraction for language detection: {file_path}")
            # Use context manager to ensure PDF is properly closed
            with fitz.open(file_path) as doc:
                total_pages = len(doc)
                pages_to_extract = min(10, total_pages)

                combined_text = ""
                for page_num in range(pages_to_extract):
                    page = doc.load_page(page_num)
                    page_text = page.get_text()
                    combined_text += page_text + " "

            if combined_text.strip():
                # Detect language with confidence on the combined text
                detected_language, confidence = detect_language_with_confidence(combined_text)
                logger.info(
                    f"Detected language from first {pages_to_extract} pages: '{detected_language}' with confidence {confidence:.3f}")
            else:
                logger.warning("No text found in the first 10 pages of the PDF")
        except Exception as e:
            logger.error(f"Error extracting text from PDF for language detection: {str(e)}")
            detected_language = "unknown"
            confidence = 0.0
    else:
        # Original random sampling approach (when webhook_url is provided)
        max_attempts = min(5, len(chunks))  # Try up to 5 chunks or all chunks if fewer

        try:
            for attempt in range(max_attempts):
                # Select a random chunk
                random_chunk = secrets.choice(chunks)
                text_content = random_chunk.get("page_content", "")

                if not text_content.strip():
                    continue

                # Detect language with confidence
                lang, conf = detect_language_with_confidence(text_content)

                logger.info(f"Attempt {attempt + 1}: Detected language '{lang}' with confidence {conf:.3f}")

                if conf >= 0.8:
                    detected_language = lang
                    confidence = conf
                    logger.info(f"High confidence detected: {detected_language} ({confidence:.3f})")
                    break
                elif conf > confidence:
                    # Keep track of the best result so far
                    detected_language = lang
                    confidence = conf

            if confidence < 0.8:
                logger.warning(
                    f"No high-confidence language detection achieved. Using best result: {detected_language} ({confidence:.3f})")

        except Exception as e:
            logger.error(f"Error in random sampling language detection: {str(e)}")
            detected_language = "unknown"

    # Apply the detected language to all chunks
    updated_chunks = []
    for chunk in chunks:
        try:
            updated_chunk = chunk.copy()
            if "metadata" not in updated_chunk:
                updated_chunk["metadata"] = {}

            updated_chunk["metadata"]["language"] = detected_language
            updated_chunks.append(updated_chunk)

        except Exception as e:
            logger.exception(f"Error updating chunk with language: {str(e)}")
            # Add chunk with 'unknown' language as fallback
            updated_chunk = chunk.copy()
            if "metadata" not in updated_chunk:
                updated_chunk["metadata"] = {}
            updated_chunk["metadata"]["language"] = "unknown"
            updated_chunks.append(updated_chunk)

    logger.info(f"Applied language '{detected_language}' to all {len(updated_chunks)} chunks")

    # Send webhook notification if URL is provided
    if webhook_url and task_metadata:
        webhook_payload = WebhookNotificationPayload(
            event_type="language_detection_task_completed",
            task_id=task_metadata.get("task_id"),
            metadata=task_metadata.copy(),
            detected_language=detected_language,
            detection_confidence=confidence
        ).model_dump()
        send_webhook_sync(webhook_url, webhook_payload)

    return {
        'chunks': updated_chunks,
        'detected_language': detected_language,
        'detection_confidence': confidence
    }


@celery_app.task(base=BaseTaskWithRetry, name="classify-indexed-document")
def classify_indexed_document_task(
        vectorstore_name: str,
        external_id: str,
        structure_template: List[Dict[str, Any]],
        username: str,
        include_images: bool = False,
        webhook_url: Optional[str] = None,
        chunk_filter: Optional[Dict[str, Any]] = None,
        sheet_name: Optional[str] = None,
        task_metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Celery task for classifying an already indexed document by external_id using similarity classification with LLM fallback.

    This task retrieves chunks directly from Qdrant and performs classification
    without re-indexing the document. Uses similarity classification with automatic
    LLM fallback when confidence is low.

    Args:
        vectorstore_name: Name of the vectorstore/index
        external_id: External ID of the document to classify
        structure_template: Classification hierarchy structure
        username: Username for authentication and tracking
        include_images: Whether to include image chunks
        webhook_url: Optional webhook URL for notifications
        chunk_filter: Optional filters for chunks
        sheet_name: Optional sheet name to filter chunks by (for spreadsheet documents)
        task_metadata: Optional task metadata for webhooks

    Returns:
        Dict with classification results
    """
    logger.info(f"Starting classification task for external_id: {external_id}")

    try:
        # Initialize the classifier
        classifier = DocumentClassifier(
            index_name=vectorstore_name,
            directories=structure_template,
            external_id=external_id,
            username=username
        )

        # Use LLM-only classification
        result = _classify_with_llm_direct(
            classifier, external_id, structure_template,
            include_images, chunk_filter, sheet_name, vectorstore_name, username
        )

        logger.info(f"Classification completed for external_id: {external_id}")

        # Send webhook notification if URL is provided
        if webhook_url:
            predicted_category = result.get("predicted_category", "Unknown")
            final_confidence = result.get("final_confidence", 0.0)
            is_existing_category = result.get("is_existing_category", False)
            category_id = result.get("category_id")
            classification_source = result.get("classification_source", "llm_new")

            webhook_payload = WebhookNotificationPayload(
                event_type="file_classification_task",
                task_id=task_metadata.get("task_id") if task_metadata else None,
                detected_category=predicted_category,
                category_confidence=final_confidence,
                is_new_category=not is_existing_category,
                category_source=classification_source,
                category_id=category_id,
                metadata={
                    "external_id": external_id,
                    "sheet_name": sheet_name,
                    "final_confidence": final_confidence,
                    "total_chunks": result.get("total_chunks"),
                    **(task_metadata or {})
                }
            ).model_dump()
            send_webhook_sync(webhook_url, webhook_payload)

        return result

    except Exception as e:
        logger.error(f"Classification task failed for external_id {external_id}: {str(e)}")
        # Send simplified webhook notification if URL is provided
        if webhook_url:
            webhook_payload = SimpleClassificationPayload(
                event_type="file_classification_task",
                external_id=external_id,
                sheet_name=sheet_name,
                directory_id=None,  # Error case - no classification result
                metadata={
                    "classification_method": "similarity",  # Always using similarity with LLM fallback
                    "error": str(e),
                    "error_type": type(e).__name__
                }
            ).model_dump()
            send_webhook_sync(webhook_url, webhook_payload)
        raise


@celery_app.task(bind=True)
def classify_document_from_datalake_task(
    self,
    vectorstore_name: str,
    file_path: str,
    structure_template: List[Dict[str, Any]],
    username: str,
    webhook_url: Optional[str] = None,
    prompt: Optional[str] = None,
    metadata: Optional[Dict[str, str]] = None,
    sheet_name: Optional[str] = None
):
    """
    Classify document by downloading it from Azure Data Lake.

    This task downloads a file from Azure Data Lake, extracts text based on
    file type (PDF, Excel, PowerPoint, Word, or Text), and performs
    classification using LLM.

    Parameters
    ----------
    sheet_name : str, optional
        Sheet name for Excel files. If not provided, all sheets will be processed.
    """
    local_file_path = None

    try:
        # Get file extension for metadata
        file_ext = Path(file_path).suffix.lower()

        # Update task state
        self.update_state(
            state="PROGRESS",
            meta={"status": f"Downloading {file_ext.upper()} file from Azure Data Lake"}
        )

        # Download file from Azure Data Lake
        local_file_path = download_from_azure_datalake(file_path)

        # Extract text based on file type
        self.update_state(
            state="PROGRESS",
            meta={"status": f"Extracting text from {file_ext.upper()} file"}
        )

        text_content = extract_text_from_document(local_file_path, 10, sheet_name)

        if not text_content.strip():
            raise ValueError(f"No text extracted from {file_ext.upper()} file")

        # Perform classification
        self.update_state(
            state="PROGRESS",
            meta={"status": "Classifying document content"}
        )

        classification_result = _classify_text_with_llm(
            text_content,
            structure_template,
            prompt,
            username
        )

        # Prepare webhook payload
        webhook_payload = WebhookNotificationPayload(
            event_type="classification_completed",
            metadata=metadata.copy() if metadata else {},
            detected_category=classification_result.get("predicted_category"),
            category_confidence=classification_result.get("confidence"),
            is_new_category=not classification_result.get("is_existing_category", True),
            category_source="llm_new" if not classification_result.get("is_existing_category", True) else "llm_existing",
            category_id=classification_result.get("category_id", ""),
            sheet_name=sheet_name
        )

        # Send webhook if provided
        if webhook_url:
            send_webhook_sync(webhook_url, webhook_payload.model_dump())

        return_value = {
            "task_id": self.request.id,
            "status": "completed",
            "classification": classification_result,
            "file_path": file_path,
            "vectorstore_name": vectorstore_name,
            "file_type": file_ext,
            "pages_analyzed": 10
        }
        if sheet_name:
            return_value["sheet_name"] = sheet_name

        return return_value

    except Exception as e:
        logger.error(f"Document classification failed for {file_path}: {str(e)}")

        # Send error webhook
        if webhook_url:
            error_payload = WebhookNotificationPayload(
                event_type="classification_failed",
                metadata=metadata.copy() if metadata else {},
                status=NotificationStatus.FAIL,
                error_details={
                    "error_code": "CLASSIFICATION_FAILED",
                    "message": str(e),
                    "task_name": "classify_document_from_datalake_task"
                },
                sheet_name=sheet_name
            )
            send_webhook_sync(webhook_url, error_payload.model_dump())

        raise

    finally:
        # Cleanup: Delete downloaded file
        if local_file_path and os.path.exists(local_file_path):
            try:
                os.remove(local_file_path)
                logger.info(f"Cleaned up temporary file: {local_file_path}")
            except Exception as e:
                logger.warning(f"Failed to cleanup temporary file {local_file_path}: {e}")
