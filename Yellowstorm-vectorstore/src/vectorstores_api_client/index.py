import asyncio
import os
import redis
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from celery import chain, chord, group

from src.config.settings import get_settings
from src.middleware.correlation import get_user
from src.logger.logging import get_logger
from src.modules.datalake import async_download_from_azure_datalake_with_temp_folder
from src.modules.indexing.excel_structure_detection import detect_and_classify_excel_async
from src.redis_store.status import DocumentStatusRedis
from src.schema.celery_models import TaskIDS
from src.schema.chunk_style import ChunkStyle
from src.schema.fastapi.vectorstores.requests import (
    VectorstoreValidationError,
    VectorstoreIndexingError
)
from worker import (
    add_documents_task,
    add_documents_with_classification_task,
    compress_sub_images,
    convert_pdf_to_images_task,
    convert_pdf_to_txt_task,
    convert_to_pdf_task,
    create_document_object,
    create_single_image_document_task,
    delete_temp_folder,
    delete_images_and_tables_task,
    download_from_azure_datalake_task,
    filter_images,
    extract_sub_images,
    generation_graph_task,
    get_image_description,
    get_single_image_description_task,
    index_in_redis_task,
    language_detect_task,
    load_split_document_task,
    parse_document_logical_and_return_file_path_task,
    parse_document_logical_in_chain_task,
    parse_document_logical_with_local_file_task,
    post_process_segmentation_results,
    run_image_through_yolo,
    skip_indexation_for_structured_excel_task,
    split_documents_task,
    style_aware_split_pdf_from_azure_datalake_task,
    upload_compressed_images_task,
    upload_original_images_task,
    upload_pdf_to_azure_datalake_task,
    verify_qdrant_and_delete_from_redis,
)
# from src.helpers.index_notification_webhook import listen_to_task_status_webhook

settings = get_settings()
logger = get_logger("vectorstores-api.main")
# ────────────────────────── constants ──────────────────────────
TEMP_DIR_NAME = "tmp"

# ────────────────────────── helper functions ──────────────────────────
def needs_conversion(file_path: str) -> bool:
    """
    Check if a file needs to be converted to PDF.

    Parameters
    ----------
    file_path : str
        The file path to check

    Returns
    -------
    bool
        True if the file needs conversion, False if it's already PDF/JSON/TXT/XLSX
    """
    if not file_path:
        return False

    ext = Path(file_path).suffix.lower()
    # Files that don't need conversion
    no_conversion_needed = {".pdf", ".json", ".txt", ".xls", ".xlsx"}

    return ext not in no_conversion_needed


def is_image_file(file_path: str) -> bool:
    """
    Check if a file is an image file.

    Parameters
    ----------
    file_path : str
        The file path to check

    Returns
    -------
    bool
        True if the file is an image, False otherwise
    """
    if not file_path:
        return False

    ext = Path(file_path).suffix.lower()
    # Image file extensions
    image_extensions = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif", ".webp"}

    return ext in image_extensions

SMART_CHUNKING_QUEUE = "smart-chunking"
TEXT_INDEXATION_QUEUE = "text-indexation"
IMAGE_INDEXATION_QUEUE = "image-indexation"
DEFAULT_QUEUE = "default"
LOW_PRIO_QUEUE = "qdrant-index.low-priority"
REDIS_INDEX_QUEUE = "redis-index"


def build_logical_in_chain_signature(
        file_path: str,
        external_id: str,
        brain_id: str,
        source: str = None,
) -> Tuple[str, Any]:
    logical_task_id = str(uuid4())
    return logical_task_id, parse_document_logical_in_chain_task.s(
        file_path=file_path,
        external_id=external_id,
        brain_id=brain_id,
        source=source,
    ).set(queue="logical-indexing", task_id=logical_task_id)


def build_logical_with_local_file_signature(
        file_path: str,
        external_id: str,
        brain_id: str,
        local_file_path: str,
        source: str = None,
) -> Tuple[str, Any]:
    logical_task_id = str(uuid4())
    return logical_task_id, parse_document_logical_with_local_file_task.s(
        file_path=file_path,
        external_id=external_id,
        brain_id=brain_id,
        local_file_path=local_file_path,
        source=source,
    ).set(queue="logical-indexing", task_id=logical_task_id)


def build_logical_return_file_path_signature(
        file_path: str,
        external_id: str,
        brain_id: str,
        source: str = None,
) -> Tuple[str, Any]:
    logical_task_id = str(uuid4())
    return logical_task_id, parse_document_logical_and_return_file_path_task.s(
        file_path=file_path,
        external_id=external_id,
        brain_id=brain_id,
        source=source,
    ).set(queue="logical-indexing", task_id=logical_task_id)

async def async_index_documents_from_azure_datalake(
        collection_name: str,
        chunk_size: int,
        chunk_overlap: int,
        separators: List[str],
        keep_separator: bool,
        file_path: str,
        metadata: Dict[str, Any],
        enable_style_aware_chunking: bool,
        chunk_styles: Optional[List[ChunkStyle]],
        brain_id: str,
        brain_type: str,
        enable_extract_images: bool,
        correlation_id: str,
        in_memory: Optional[bool],
        webhook_url: Optional[str] ,
        sheet_name: Optional[str] = None,
) -> TaskIDS:
    """
    Index documents from Azure Data Lake asynchronously

    Parameters
    ----------
    collection_name : str
        The name of the collection
    chunk_size : int
        The size of the chunks
    chunk_overlap : int
        The size of the overlap between chunks
    separators : List[str]
        The separators to use
    keep_separator : bool
        Whether to keep the separator
    file_path : str
        The path of the file in Azure Data Lake
    metadata : Dict[str, Any]
        The metadata, including the source, brain ID, external ID and language code
    enable_style_aware_chunking : bool
        Whether to enable style-aware chunking (only works for .pdf files)
    chunk_styles : Optional[List[ChunkStyle]]
        The chunk styles to use for style-aware chunking, only required if enable_style_aware_chunking is True

    Returns
    -------
    TaskID
        The ID of the task
    """
    user_id=get_user()
    # Validate inputs
    if not collection_name or not collection_name.strip():
        raise VectorstoreValidationError(
            message="Collection name is required and cannot be empty",
            indexing_operation="collection_name",
            details={"provided_value": collection_name},
        )

    if not file_path or not file_path.strip():
        raise VectorstoreValidationError(
            message="File path is required and cannot be empty",
            indexing_operation="file_path",
            details={"provided_value": file_path},
        )

    if brain_type not in ["doc", "graph"]:
        raise VectorstoreValidationError(
            message="Invalid brain type. Valid brain types are 'doc' and 'graph'",
            indexing_operation="brain_type",
            details={"provided_value": brain_type, "valid_types": ["doc", "graph"]},
        )

    temp_folder = os.path.join(settings.SHARED_VOLUME_PREFIX, TEMP_DIR_NAME, str(uuid4()))
    
    # Prepare webhook metadata for language detection
    webhook_metadata = None
    if webhook_url:
        webhook_metadata = {
            "task_id": correlation_id,
            "brain_id": brain_id,
            "brain_type": brain_type,
            "collection_name": collection_name,
            "file_path": file_path,
            "user_id": get_user(),
            **(metadata if metadata else {})
        }

    external_id = metadata.get("external_id") if metadata else None
    if external_id is None:
        raise VectorstoreValidationError(
            message="External ID is required in metadata",
            indexing_operation="external_id",
            details={"metadata": metadata},
        )

    # Set IMPORTED status synchronously in Redis before starting Celery chain
    # Skip status tracking for Excel files for now (they should search Qdrant directly)
    r = redis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        db=settings.REDIS_DB,
        username=settings.REDIS_USER,
        password=settings.REDIS_PASSWORD,
        ssl=getattr(settings, 'ENABLE_REDIS_SSL', False),
        decode_responses=True
    )
    redis_store = DocumentStatusRedis(r)

    file_extension = os.path.splitext(file_path)[-1].lower()

    if file_extension in [".xls", ".xlsx"]:
        try:
            status_key = f"doc_status/{brain_id}/{external_id}"
            redis_store.delete_status_by_key(status_key)
            logger.info(f"Skipped Redis status for Excel file {external_id}")
        except Exception as e:
            logger.warning(f"Failed to clear Redis status for Excel file {external_id}: {e}")
    else:
        redis_store.save_imported_status(
            brain_id=brain_id,
            external_id=external_id,
            file_path=file_path,
            vectorstore_name=collection_name,
            source=metadata.get("source") if metadata else None,
        )
        logger.info(f"Set IMPORTED status for {external_id} in brain {brain_id}")

    chain_tasks = []
    logical_task_id = None
    try:
        if brain_type == "doc":
            file_extension = os.path.splitext(file_path)[-1].lower()

            # Image file pipeline - bypasses PDF conversion for direct image indexing
            if is_image_file(file_path):
                logical_task_id, logical_signature = build_logical_in_chain_signature(
                    file_path=file_path,
                    external_id=external_id,
                    brain_id=brain_id,
                    source=metadata.get("source"),
                )
                image_chain = chain(
                    download_from_azure_datalake_task.s(file_path, temp_folder=temp_folder).set(
                        queue=IMAGE_INDEXATION_QUEUE
                    ),
                    logical_signature,
                    get_single_image_description_task.s(file_path, metadata, user_id).set(
                        queue=IMAGE_INDEXATION_QUEUE
                    ),
                    create_single_image_document_task.s(file_path, metadata).set(
                        queue=IMAGE_INDEXATION_QUEUE
                    ),
                    add_documents_task.s(
                        collection_name=collection_name,
                        external_id=external_id,
                        user_id=user_id,
                        include_images=True,
                        webhook_url=webhook_url,
                        webhook_metadata=webhook_metadata,
                    ).set(queue=LOW_PRIO_QUEUE),
                    delete_temp_folder.s(temp_folder=temp_folder).set(queue=DEFAULT_QUEUE),
                )
                result = image_chain.delay() # execute task asynch

                return TaskIDS(
                    id=result.task_id,
                    id_image=None,
                    id_classification=None,
                    temp_folder=temp_folder,
                    logical_task_id=logical_task_id
                )

            # PHAC LIST functionality not available in vectorstores-api
            # if brain_id in [settings.BRAIN_PHAC_CHAT,settings.BRAIN_RM_PHAC] and file_extension == ".xlsx":
            #     chain_tasks.extend(
            #         [
            #             indexation_PHAC_LIST_task.s(
            #                 file_path=file_path,
            #                 index_name="phac-indexer",
            #                 brain_id=brain_id,
            #                 file_name=metadata["source"],
            #                 external_id=metadata["external_id"]
            #             ),
            #         ]
            #     )

            # Smart chunking sans indexation image
            if enable_style_aware_chunking and not enable_extract_images:
                assert chunk_styles is not None
                chunk_styles = [chunk_style.dict() for chunk_style in chunk_styles]
                logical_task_id, logical_signature = build_logical_return_file_path_signature(
                    file_path=file_path,
                    external_id=external_id,
                    brain_id=brain_id,
                    source=metadata.get("source"),
                )
                chain_tasks.extend(
                    [
                        logical_signature,
                        style_aware_split_pdf_from_azure_datalake_task.s(
                            file_path,
                            chunk_styles,
                            metadata,
                            correlation_id=correlation_id,
                        ).set(queue=SMART_CHUNKING_QUEUE),
                        split_documents_task.s(
                            chunk_size,
                            chunk_overlap,
                            separators,
                            keep_separator,
                            enable_style_aware_chunking,
                        ).set(queue=SMART_CHUNKING_QUEUE),
                        index_in_redis_task.s().set(queue=REDIS_INDEX_QUEUE),
                        language_detect_task.s(webhook_url, webhook_metadata).set(
                            queue=SMART_CHUNKING_QUEUE
                        ),
                        add_documents_task.s(
                            collection_name=collection_name,
                            external_id=external_id,
                            user_id=user_id,
                            include_images=False,
                            webhook_url=webhook_url,
                            webhook_metadata=webhook_metadata,
                        ).set(queue=LOW_PRIO_QUEUE),
                        verify_qdrant_and_delete_from_redis.s(
                            brain_id=brain_id,
                            external_id=external_id,
                            collection_name=collection_name
                        ).set(queue=LOW_PRIO_QUEUE)
                    ]
                )

            # Indexation lorsque indexation image disabled - text only
            if (
                    not enable_extract_images
                    and not enable_style_aware_chunking
                    and not in_memory
            ):

                # Check if file needs conversion
                if needs_conversion(file_path):
                    # File needs conversion: download -> convert -> process
                    logical_task_id, logical_signature = build_logical_in_chain_signature(
                        file_path=file_path,
                        external_id=external_id,
                        brain_id=brain_id,
                        source=metadata.get("source"),
                    )
                    chain_tasks.extend(
                        [
                            download_from_azure_datalake_task.s(
                                file_path, temp_folder=temp_folder
                            ).set(queue=DEFAULT_QUEUE),
                            convert_to_pdf_task.s(original_file_path=file_path, temp_folder=temp_folder).set(
                                queue="conversion"),
                            logical_signature,
                            load_split_document_task.s(
                                metadata,
                                chunk_size=chunk_size,
                                chunk_overlap=chunk_size // 5,
                                sheet_name=sheet_name,
                                brain_id=brain_id,
                                external_id=external_id,
                            ).set(queue=DEFAULT_QUEUE),
                            # text only pipeline when could be used ?
                            index_in_redis_task.s().set(queue=REDIS_INDEX_QUEUE),
                            language_detect_task.s(webhook_url, webhook_metadata).set(
                                queue=DEFAULT_QUEUE
                            ),
                            add_documents_task.s(
                                collection_name=collection_name,
                                external_id=external_id,
                                user_id=user_id,
                                include_images=False,
                                webhook_url=webhook_url,
                                webhook_metadata=webhook_metadata,
                            ).set(queue=DEFAULT_QUEUE),
                            verify_qdrant_and_delete_from_redis.s(brain_id, external_id, collection_name).set(
                                queue=DEFAULT_QUEUE)
                        ]
                    )
                else:
                    # File doesn't need conversion: direct download -> process
                    # For Excel files, do async structure detection first
                    if file_extension in ['.xls', '.xlsx']:
                        # Async download and detect
                        downloaded_path = await async_download_from_azure_datalake_with_temp_folder(
                            file_path, temp_folder
                        )
                        detection_result = await detect_and_classify_excel_async(downloaded_path)

                        # If structured Excel, return immediately with dummy task
                        if detection_result.get("is_structured"):
                            dummy_task = skip_indexation_for_structured_excel_task.s(
                                detection_result.get("classification"),
                                temp_folder
                            )
                            logical_task_id, logical_signature = build_logical_with_local_file_signature(
                                file_path=file_path,
                                external_id=external_id,
                                brain_id=brain_id,
                                local_file_path=downloaded_path,
                                source=metadata.get("source"),
                            )
                            result = chain(
                                dummy_task,
                                logical_signature,
                                delete_temp_folder.s(temp_folder=temp_folder).set(queue=DEFAULT_QUEUE),
                            ).delay()

                            return TaskIDS(
                                id=result.id,
                                id_image=None,
                                id_classification=None,
                                temp_folder=temp_folder,
                                logical_task_id=logical_task_id
                            )

                        # Unstructured Excel - build normal chain
                        logical_task_id, logical_signature = build_logical_with_local_file_signature(
                            file_path=file_path,
                            external_id=external_id,
                            brain_id=brain_id,
                            local_file_path=downloaded_path,
                            source=metadata.get("source"),
                        )
                        chain_tasks.extend(
                            [
                                logical_signature,
                                convert_pdf_to_images_task.s(image=False,file_path=downloaded_path).set(queue=DEFAULT_QUEUE),
                                load_split_document_task.s(
                                    metadata,
                                    chunk_size=chunk_size,
                                    chunk_overlap=chunk_size // 5,
                                    sheet_name=sheet_name,
                                    brain_id=brain_id,
                                    external_id=external_id,
                                ).set(queue=DEFAULT_QUEUE),
                                index_in_redis_task.s().set(queue=REDIS_INDEX_QUEUE),
                                language_detect_task.s(webhook_url, webhook_metadata).set(
                                    queue=DEFAULT_QUEUE
                                ),
                                add_documents_task.s(
                                    collection_name=collection_name,
                                    external_id=external_id,
                                    user_id=user_id,
                                    include_images=False,
                                    webhook_url=webhook_url,
                                    webhook_metadata=webhook_metadata,
                                ).set(queue=LOW_PRIO_QUEUE),
                                verify_qdrant_and_delete_from_redis.s(brain_id, external_id, collection_name).set(
                                    queue=DEFAULT_QUEUE)
                            ]
                        )
                    else:
                        # Non-Excel files - normal flow with download task
                        logical_task_id, logical_signature = build_logical_in_chain_signature(
                            file_path=file_path,
                            external_id=external_id,
                            brain_id=brain_id,
                            source=metadata.get("source"),
                        )
                        chain_tasks.extend(
                            [
                                download_from_azure_datalake_task.s(
                                    file_path, temp_folder=temp_folder
                                ).set(queue=DEFAULT_QUEUE),
                                logical_signature,
                                convert_pdf_to_images_task.s(image=False).set(queue=DEFAULT_QUEUE),
                                load_split_document_task.s(
                                    metadata,
                                    chunk_size=chunk_size,
                                    chunk_overlap=chunk_size // 5,
                                    sheet_name=sheet_name,
                                    brain_id=brain_id,
                                    external_id=external_id,
                                ).set(queue=DEFAULT_QUEUE),
                                index_in_redis_task.s().set(queue=REDIS_INDEX_QUEUE),
                                language_detect_task.s(webhook_url, webhook_metadata).set(
                                    queue=DEFAULT_QUEUE
                                ),
                                add_documents_task.s(
                                    collection_name=collection_name,
                                    external_id=external_id,
                                    user_id=user_id,
                                    include_images=False,
                                    webhook_url=webhook_url,
                                    webhook_metadata=webhook_metadata,
                                ).set(queue=DEFAULT_QUEUE),
                                verify_qdrant_and_delete_from_redis.s(brain_id, external_id, collection_name).set(
                                    queue=DEFAULT_QUEUE)
                            ]
                        )
            # Indexation image enabled
            if enable_extract_images:
                document_path = file_path
                datalake_directory = "/".join(file_path.split("/")[:-1])
                temp_file_path = os.path.join(temp_folder, os.path.basename(file_path))

                if enable_style_aware_chunking:
                    assert chunk_styles is not None
                    chunk_styles = [chunk_style.dict() for chunk_style in chunk_styles]

                logical_task_id, logical_signature = build_logical_in_chain_signature(
                    file_path=file_path,
                    external_id=external_id,
                    brain_id=brain_id,
                    source=metadata.get("source"),
                )

                # === SHARED FIRST STEP: download + optional PDF conversion (runs once) ===
                if needs_conversion(file_path):
                    shared_step = chain(
                        download_from_azure_datalake_task.s(document_path, temp_folder).set(
                            queue=TEXT_INDEXATION_QUEUE),
                        convert_to_pdf_task.s(original_file_path=document_path, temp_folder=temp_folder).set(
                            queue="conversion"),
                    )
                else:
                    shared_step = chain(
                        download_from_azure_datalake_task.s(document_path, temp_folder).set(
                            queue=TEXT_INDEXATION_QUEUE),
                    )

                # === img_group: processes images → add_documents ===
                img_group = chain(
                    post_process_segmentation_results.s().set(
                        queue=IMAGE_INDEXATION_QUEUE
                    ),
                    extract_sub_images.s().set(
                        queue=IMAGE_INDEXATION_QUEUE
                    ),
                    filter_images.s().set(
                        queue=IMAGE_INDEXATION_QUEUE
                    ),
                    compress_sub_images.s().set(
                        queue=IMAGE_INDEXATION_QUEUE
                    ),
                    upload_original_images_task.s(destination_path=datalake_directory).set(
                        queue=IMAGE_INDEXATION_QUEUE
                    ),
                    upload_compressed_images_task.s(destination_path=datalake_directory).set(
                        queue=IMAGE_INDEXATION_QUEUE
                    ),
                    get_image_description.s(datalake_directory, metadata=metadata, user_id=user_id).set(
                        queue=IMAGE_INDEXATION_QUEUE
                    ),
                    create_document_object.s(metadata=metadata).set(
                        queue=IMAGE_INDEXATION_QUEUE
                    ),
                    language_detect_task.s(file_path=temp_file_path).set(queue=IMAGE_INDEXATION_QUEUE),
                    add_documents_task.s(
                        collection_name=collection_name,
                        external_id=external_id,
                        user_id=user_id,
                        include_images=True,
                        webhook_url=webhook_url,
                        webhook_metadata=webhook_metadata,
                    ).set(queue=LOW_PRIO_QUEUE)
                )

                # === text_group: processes text → add_documents ===
                if enable_style_aware_chunking:
                    text_group = chain(
                        delete_images_and_tables_task.s(temp_folder=temp_folder).set(queue=SMART_CHUNKING_QUEUE),
                        upload_pdf_to_azure_datalake_task.s(file_path=file_path).set(queue=SMART_CHUNKING_QUEUE),
                        style_aware_split_pdf_from_azure_datalake_task.s(
                            file_path,
                            chunk_styles,
                            metadata,
                            correlation_id=correlation_id,
                        ).set(queue=SMART_CHUNKING_QUEUE),
                        split_documents_task.s(
                            chunk_size,
                            chunk_overlap,
                            separators,
                            keep_separator,
                            enable_style_aware_chunking,
                        ).set(queue=SMART_CHUNKING_QUEUE),
                        language_detect_task.s(webhook_url, webhook_metadata).set(queue=SMART_CHUNKING_QUEUE),
                        add_documents_task.s(
                            collection_name=collection_name,
                            external_id=external_id,
                            user_id=user_id,
                            include_images=False,
                            webhook_url=webhook_url,
                            webhook_metadata=webhook_metadata,
                        ).set(queue=LOW_PRIO_QUEUE)
                    )
                else:
                    text_group = chain(
                        delete_images_and_tables_task.s(temp_folder=temp_folder).set(queue=TEXT_INDEXATION_QUEUE),
                        load_split_document_task.s(
                            metadata,
                            chunk_size=chunk_size,
                            chunk_overlap=chunk_size // 5,
                            sheet_name=sheet_name,
                            brain_id=brain_id,
                            external_id=external_id,
                        ).set(queue=TEXT_INDEXATION_QUEUE),
                        language_detect_task.s(webhook_url, webhook_metadata).set(queue=TEXT_INDEXATION_QUEUE),
                        add_documents_task.s(
                            collection_name=collection_name,
                            external_id=external_id,
                            user_id=user_id,
                            include_images=False,
                            webhook_url=webhook_url,
                            webhook_metadata=webhook_metadata,
                        ).set(queue=LOW_PRIO_QUEUE)
                    )

                # === BRANCH 1: Redis BM25 text indexing ===
                redis_branch = chain(
                    load_split_document_task.s(
                        metadata,
                        chunk_size=chunk_size,
                        chunk_overlap=chunk_size // 5,
                        sheet_name=sheet_name,
                        brain_id=brain_id,
                        external_id=external_id,
                    ).set(queue=TEXT_INDEXATION_QUEUE),
                    index_in_redis_task.s().set(queue=REDIS_INDEX_QUEUE),
                )

                # === BRANCH 2: YOLO → img + text → Qdrant → verify ===
                yolo_branch = chain(
                    logical_signature,
                    convert_pdf_to_images_task.s(image=True).set(queue=TEXT_INDEXATION_QUEUE),
                    run_image_through_yolo.s().set(queue=TEXT_INDEXATION_QUEUE),
                    chord(
                        group(img_group, text_group),
                        verify_qdrant_and_delete_from_redis.s(
                            brain_id=brain_id,
                            external_id=external_id,
                            collection_name=collection_name,
                        ).set(queue=TEXT_INDEXATION_QUEUE),
                    ),
                )

                # === COMBINED: shared step → parallel branches ===
                workflow = chain(
                    shared_step,
                    group(redis_branch, yolo_branch),
                    delete_temp_folder.s(temp_folder=temp_folder).set(queue=DEFAULT_QUEUE),
                )
                result = workflow.delay()

                logger.info(
                    f"Image-enabled workflow started: shared(download{'+convert' if needs_conversion(file_path) else ''}) "
                    f"→ group(redis_branch || yolo_branch). Task ID: {result.id}"
                )

                return TaskIDS(
                    id=result.id,
                    id_image=None,
                    id_classification=None,
                    temp_folder=temp_folder,
                    logical_task_id=logical_task_id
                )

        else:
            assert chunk_styles is not None
            datalake_directory = "/".join(file_path.split("/")[:-1])

            # Check if file needs conversion for graph generation
            if needs_conversion(file_path):
                # File needs conversion: download -> convert -> process
                logical_task_id, logical_signature = build_logical_in_chain_signature(
                    file_path=file_path,
                    external_id=external_id,
                    brain_id=brain_id,
                    source=metadata.get("source"),
                )
                chain_tasks.extend(
                    [
                        download_from_azure_datalake_task.s(file_path, temp_folder).set(
                            queue=DEFAULT_QUEUE
                        ),
                        convert_to_pdf_task.s(file_path, temp_folder).set(queue="conversion"),
                        logical_signature,
                        convert_pdf_to_txt_task.s().set(queue=DEFAULT_QUEUE),
                        generation_graph_task.s(os.path.join(settings.SHARED_VOLUME_PREFIX, TEMP_DIR_NAME, f"graph_{brain_id}_index"),3072,datalake_directory,user_id=user_id).set(queue=DEFAULT_QUEUE),
                    ]
                )
            else:
                # File doesn't need conversion: direct download -> process
                logical_task_id, logical_signature = build_logical_in_chain_signature(
                    file_path=file_path,
                    external_id=external_id,
                    brain_id=brain_id,
                    source=metadata.get("source"),
                )
                chain_tasks.extend(
                    [
                        download_from_azure_datalake_task.s(file_path, temp_folder).set(
                            queue=DEFAULT_QUEUE
                        ),
                        logical_signature,
                        convert_pdf_to_txt_task.s().set(queue=DEFAULT_QUEUE),
                        generation_graph_task.s(os.path.join(settings.SHARED_VOLUME_PREFIX, TEMP_DIR_NAME, f"graph_{brain_id}_index"),3072,datalake_directory,user_id=user_id).set(queue=DEFAULT_QUEUE),
                    ]
                )

        # Execute the chain for non-image-enabled workflows
        # (image-enabled workflows return inline)
        if chain_tasks:
            chain_tasks.append(
                delete_temp_folder.s(temp_folder=temp_folder).set(queue=DEFAULT_QUEUE)
            )
            tasks_chain = chain(*chain_tasks)
            result = tasks_chain.delay()

            return TaskIDS(
                id=result.task_id,
                id_image=None,
                id_classification=None,
                temp_folder=temp_folder,
                logical_task_id=logical_task_id
            )

        # If we get here, something went wrong (no chain_tasks and no image workflow)
        logger.error("No workflow was configured for the given parameters")
        raise VectorstoreIndexingError(
            message="No valid workflow configuration found",
            indexing_operation="workflow_selection",
            details={
                "brain_type": brain_type,
                "enable_extract_images": enable_extract_images,
                "enable_style_aware_chunking": enable_style_aware_chunking,
                "in_memory": in_memory
            }
        )
    except Exception as e:
        logger.error(f"error occured in async_index_documents_from_azure_datalake: {e}")
        raise
