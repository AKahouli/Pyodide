import asyncio
import os
import redis
from pathlib import Path
from typing import Any, Dict, List, Optional
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
    try:
        if brain_type == "doc":
            file_extension = os.path.splitext(file_path)[-1].lower()

            # Image file pipeline - bypasses PDF conversion for direct image indexing
            if is_image_file(file_path):
                image_chain = chain(
                    download_from_azure_datalake_task.s(file_path, temp_folder=temp_folder).set(
                        queue=IMAGE_INDEXATION_QUEUE
                    ),
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
                )
                result = image_chain.delay() # execute task asynch
                return TaskIDS(id=result.task_id, id_image=None, id_classification=None, temp_folder=temp_folder)

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
            if enable_style_aware_chunking:
                assert chunk_styles is not None
                chunk_styles = [chunk_style.dict() for chunk_style in chunk_styles]
                if not enable_extract_images:
                    chain_tasks.extend(
                        [
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
                            # can remove it cuz we smart chunking is deprecated
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
                    chain_tasks.extend(
                        [
                            download_from_azure_datalake_task.s(
                                file_path, temp_folder=temp_folder
                            ).set(queue=DEFAULT_QUEUE),
                            convert_to_pdf_task.s(original_file_path=file_path, temp_folder=temp_folder).set(
                                queue="conversion"),
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
                            result = dummy_task.apply_async()

                            # Start webhook listener
                            if webhook_url:
                                # Note: webhook listener should be started by the caller (router)
                                pass

                            return TaskIDS(
                                id=result.id,
                                id_image=None,
                                id_classification=None,
                                temp_folder=temp_folder
                            )

                        # Unstructured Excel - build normal chain
                        chain_tasks.extend(
                            [
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
                        chain_tasks.extend(
                            [
                                download_from_azure_datalake_task.s(
                                    file_path, temp_folder=temp_folder
                                ).set(queue=DEFAULT_QUEUE),
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
                # Local imports for image-enabled pipeline
                document_path = file_path
                datalake_directory = "/".join(file_path.split("/")[:-1])
                temp_file_path = os.path.join(temp_folder, os.path.basename(file_path))

                if enable_style_aware_chunking:
                    assert chunk_styles is not None
                    chunk_styles = [chunk_style.dict() for chunk_style in chunk_styles]

                # === PARALLEL CHAINS: redis_group and yolo_group ===

                # CHAIN 1: Redis pipeline (independent, no YOLO)
                # Runs in parallel, loads and indexes in Redis for BM25 search
                if needs_conversion(file_path):
                    redis_group = chain(
                        download_from_azure_datalake_task.s(document_path, temp_folder).set(
                            queue=TEXT_INDEXATION_QUEUE),
                        convert_to_pdf_task.s(original_file_path=document_path, temp_folder=temp_folder).set(
                            queue="conversion"),
                        load_split_document_task.s(
                            metadata,
                            chunk_size=chunk_size,
                            chunk_overlap=chunk_size // 5,
                            sheet_name=sheet_name,
                            brain_id=brain_id,
                            external_id=external_id,
                        ).set(queue=TEXT_INDEXATION_QUEUE),
                        index_in_redis_task.s().set(queue=REDIS_INDEX_QUEUE)
                    )
                else:
                    redis_group = chain(
                        download_from_azure_datalake_task.s(document_path, temp_folder).set(
                            queue=TEXT_INDEXATION_QUEUE),
                        load_split_document_task.s(
                            metadata,
                            chunk_size=chunk_size,
                            chunk_overlap=chunk_size // 5,
                            sheet_name=sheet_name,
                            brain_id=brain_id,
                            external_id=external_id,
                        ).set(queue=TEXT_INDEXATION_QUEUE),
                        index_in_redis_task.s().set(queue=REDIS_INDEX_QUEUE)
                    )

                # CHAIN 2: YOLO pipeline (convert_to_images → YOLO, output diverges to img_group and text_group)
                # Runs in PARALLEL with redis_group
                if needs_conversion(file_path):
                    yolo_group = chain(
                        download_from_azure_datalake_task.s(document_path, temp_folder).set(
                            queue=TEXT_INDEXATION_QUEUE),
                        convert_to_pdf_task.s(original_file_path=document_path, temp_folder=temp_folder).set(
                            queue="conversion"),
                        convert_pdf_to_images_task.s(image=True).set(queue=TEXT_INDEXATION_QUEUE),
                        run_image_through_yolo.s().set(queue=TEXT_INDEXATION_QUEUE)
                    )
                else:
                    yolo_group = chain(
                        download_from_azure_datalake_task.s(document_path, temp_folder).set(
                            queue=TEXT_INDEXATION_QUEUE),
                        convert_pdf_to_images_task.s(image=True).set(queue=TEXT_INDEXATION_QUEUE),
                        run_image_through_yolo.s().set(queue=TEXT_INDEXATION_QUEUE)
                    )

                # === YOLO OUTPUT DIVERGES INTO img_group and text_group ===
                # Both receive (yolo_result, file_path) from yolo_group and run in parallel

                # img_group: processes images → add_documents
                img_group = chain(
                    post_process_segmentation_results.s().set(
                        queue=IMAGE_INDEXATION_QUEUE
                    ),  # Step 4: Post-process segmentation
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
                    get_image_description.s(datalake_directory, metadata=metadata,user_id=user_id).set(
                        queue=IMAGE_INDEXATION_QUEUE
                    ),
                    create_document_object.s(metadata=metadata).set(
                        queue=IMAGE_INDEXATION_QUEUE
                    ),  # Step 9: Create document object
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

                # text_group: processes text → add_documents
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

                # === PARALLEL EXECUTION WORKFLOW ===
                # Structure: redis_group runs independently, yolo_group → (img_group + text_group) → verify

                # Step 1: Execute redis_group independently for Redis BM25 indexing
                redis_result = redis_group.delay()

                # Step 2: Execute yolo_group → chord(img_group || text_group) → verify
                # yolo_group runs and returns (yolo_result, file_path)
                # Then img_group and text_group run in parallel, receiving yolo output
                # Finally verify_qdrant_and_delete_from_redis is called with both results
                yolo_verify_workflow = chain(
                    yolo_group,
                    chord(
                        group(img_group, text_group),
                        verify_qdrant_and_delete_from_redis.s(
                            brain_id=brain_id,
                            external_id=external_id,
                            collection_name=collection_name
                        ).set(queue=TEXT_INDEXATION_QUEUE)
                    )
                )
                qdrant_verify_result = yolo_verify_workflow.delay()

                logger.info(
                    f"Parallel workflow started: redis_group (delay={redis_result.id}) || (yolo → img+text → verify (delay={qdrant_verify_result.id})). Task ID: {qdrant_verify_result.id}")

                # Return task IDs for tracking
                return TaskIDS(
                    id=qdrant_verify_result.id,  # Main task ID (verification)
                    id_image=None,
                    id_classification=None,
                    id_redis=redis_result.id,  # Redis group task ID
                    temp_folder=temp_folder
                )

        else:
            assert chunk_styles is not None
            datalake_directory = "/".join(file_path.split("/")[:-1])

            # Check if file needs conversion for graph generation
            if needs_conversion(file_path):
                # File needs conversion: download -> convert -> process
                chain_tasks.extend(
                    [
                        download_from_azure_datalake_task.s(file_path, temp_folder).set(
                            queue=DEFAULT_QUEUE
                        ),
                        convert_to_pdf_task.s(file_path, temp_folder).set(queue="conversion"),
                        convert_pdf_to_txt_task.s().set(queue=DEFAULT_QUEUE),
                        generation_graph_task.s(os.path.join(settings.SHARED_VOLUME_PREFIX, TEMP_DIR_NAME, f"graph_{brain_id}_index"),3072,datalake_directory,user_id=user_id).set(queue=DEFAULT_QUEUE),
                    ]
                )
            else:
                # File doesn't need conversion: direct download -> process
                chain_tasks.extend(
                    [
                        download_from_azure_datalake_task.s(file_path, temp_folder).set(
                            queue=DEFAULT_QUEUE
                        ),
                        convert_pdf_to_txt_task.s().set(queue=DEFAULT_QUEUE),
                        generation_graph_task.s(os.path.join(settings.SHARED_VOLUME_PREFIX, TEMP_DIR_NAME, f"graph_{brain_id}_index"),3072,datalake_directory,user_id=user_id).set(queue=DEFAULT_QUEUE),
                    ]
                )

        # Execute the chain for non-image-enabled workflows
        # (image-enabled workflows return inline)
        if chain_tasks:
            tasks_chain = chain(*chain_tasks)
            result = tasks_chain.delay()
            return TaskIDS(id=result.task_id, id_image=None, id_classification=None, temp_folder=temp_folder)

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
