import asyncio
import json
import os
from datetime import timedelta
from typing import Annotated, Any, Dict
from typing import List
from uuid import uuid4
import aiohttp
from fastapi import APIRouter, HTTPException, status, BackgroundTasks, Depends, Request
from fastapi.security import OAuth2PasswordRequestForm

from src.config.settings import get_settings
from src.dependencies.authentication import get_current_active_user, r
from src.helpers.authentification import authenticate_user, create_access_token
from src.helpers.document_relationship_helper import extract_attributes, generate_relationships, \
    load_pdf_pages
from src.helpers.index_notification_webhook import listen_to_task_status_webhook
from src.logger.logging import get_logger
from src.modules.datalake import async_download_from_azure_datalake
from src.schema.authentification import User, Token
from src.schema.celery_models import TaskStatus
from src.schema.fastapi.vectorstores.requests import (
    IndexDocument,
    VectorStoreDeleteById,
    VectorStoreQuery_ForDelete,
    VectorStoreQuery,
    VectorstoreBaseException,
    VectorstoreSearchError,
    VectorstoreValidationError,
    VectorstoreDeletionError,
    VectorstoreWebhookError,
    ClassifyDocumentRequest
)
from src.schema.fastapi.vectorstores.responses import (
    PendingDownloadIndexing,
    VectorIds,
    IndexingTokens,
    PendingClassificationTask,
)
from src.schema.logical_indexing import LogicalIndexingRequest, LogicalIndexingResponse
from src.schema.workers.doc_relationship import ProcessRequest
from src.vectorstores_api_client import (
    async_index_documents_from_azure_datalake,
    async_delete_by_ids,
    get_task_status,
    query_collection_by_filter
)

from src.modules.qdrant_search.get_qdrant_collection import get_qdrant_client

from src.modules.qdrant_search.filter import dict_to_qdrant_filter
from worker import celery_app

app_settings = get_settings()
logger = get_logger("vectorstores-api.main")

router = APIRouter(

    tags=["vectorstores"],
)


@router.post(
    "/token",
    response_model=Token,
    summary="Login to get an access token",
    description="Login to get an access token",
)
async def login_for_access_token(request: Request, form_data: Annotated[OAuth2PasswordRequestForm, Depends()]):
    # Apply rate limiting using the app's configured Redis-backed limiter
    limiter = request.app.state.limiter

    # Create a wrapper function that the limiter decorator can work with
    @limiter.limit("5/minute")
    async def rate_limited_handler():
        pass

    # Execute the rate limit check with the request
    await rate_limited_handler(request)

    logger.info("Authentication token request initiated")
    logger.info(f"Login attempt for user {form_data.username}")
    logger.info(f"Retrieving user from Redis on {app_settings.REDIS_HOST}:{app_settings.REDIS_PORT}")
    user = authenticate_user(r, form_data.username, form_data.password)
    if not user:
        logger.info(f"Login failed for user {form_data.username}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    logger.info(f"Login successful for user {form_data.username}")
    logger.info(f"Creating access token for user {form_data.username}")
    access_token_expires = timedelta(minutes=app_settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(data={"sub": user.username}, expires_delta=access_token_expires)
    logger.info(f"Access token created for user {form_data.username}")
    return {"access_token": access_token, "token_type": "bearer"}


@router.post(
    "/vectorstores/indexDocumentFromAzureDatalake",
    response_model=PendingDownloadIndexing,
    status_code=status.HTTP_201_CREATED,
    description="""This endpoint indexes a document on the vector store from Azure Datalake.

    Note: Classification is no longer part of the indexing process. To classify documents,
    use the separate /vectorstores/classify endpoint after indexing.""",
    summary="Index document on vector store from Azure Datalake",
)
async def index_document_from_azure_datalake(
        request: Request,
        document: IndexDocument,
        background_tasks: BackgroundTasks,
        current_user: Annotated[User, Depends(get_current_active_user)],
):
    logger.info(f"Document indexing request initiated for vectorstore: {document.vectorstore_name}")
    try:

        env_value_vectorstore_name = app_settings.QDRANT_COLLECTION_NAME
        if env_value_vectorstore_name:
            env_value_vectorstore_name = env_value_vectorstore_name.strip().strip('"').strip("'")

        payload_vectorstore_name = document.vectorstore_name

        # Priority logic: payload > env > error
        if payload_vectorstore_name:
            vectorstore_name = payload_vectorstore_name
        elif env_value_vectorstore_name:
            vectorstore_name = env_value_vectorstore_name
        else:
            raise VectorstoreValidationError(
                message="QDRANT_COLLECTION_NAME environment variable is not set",
                field="QDRANT_COLLECTION_NAME",
            )

        file_path = document.filepath
        saved_source = document.source
        brain_id = document.brain_id
        sheet_name = document.sheet_name
        external_id = document.external_id
        request_metadata = document.metadata or {}
        separators = document.separators
        keep_separator = document.keep_separator
        chunk_size = document.chunk_size
        chunk_overlap = document.chunk_overlap
        lang_code = document.lang_code
        enable_smart_chunk = document.enable_smart_chunk
        chunk_style = document.chunk_style
        brain_type = document.brain_type
        enable_extract_images = document.enable_extract_images
        webhook_url = document.webhook_url
        correlation_id = request.headers.get("correlation-id", str(uuid4()))
        brain_tag = document.brain_tag
        image_analyzer = document.image_analyzer
        oneshot_prompt = document.oneshot_prompt
        in_memory = document.in_memory

        logger.info(f"Preparing to index file: {file_path}")
        logger.info(f"Checking if vectorstore exists: {vectorstore_name} ")

        metadata = {
            "source": saved_source if saved_source is not None else file_path,
            "brain_id": brain_id,
            "external_id": external_id if external_id is not None else file_path,
            "language": lang_code,
        }
        listener_metadata = {
            **request_metadata,
            **metadata,
        }
        
        result = await async_index_documents_from_azure_datalake(
            collection_name=vectorstore_name,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            separators=separators,
            keep_separator=keep_separator,
            file_path=file_path,
            metadata=metadata,
            enable_style_aware_chunking=enable_smart_chunk,
            chunk_styles=chunk_style,
            brain_id=brain_id,
            brain_type=brain_type,
            enable_extract_images=enable_extract_images,
            correlation_id=correlation_id,
            in_memory=in_memory,
            webhook_url=webhook_url,
            sheet_name=sheet_name,
        )

        background_tasks.add_task(
            listen_to_task_status_webhook,
            result.id,
            listener_metadata,
            logger,
            webhook_url,
            result.id_image,
            result.logical_task_id,
            result.temp_folder,
        )

        return PendingDownloadIndexing(
            download_id=result.id,
            indexing_id=result.id,
        )

    except VectorstoreValidationError as e:
        logger.warning(f"Validation error in index_document_from_azure_datalake: {e.message}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error_code": e.error_code,
                "message": e.message,
                "details": e.details
            }
        )
    except VectorstoreBaseException as e:
        logger.exception(f"Vectorstore error in index_document_from_azure_datalake: {e.message}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error_code": e.error_code,
                "message": e.message,
                "details": e.details
            }
        )
    except Exception as e:
        logger.exception(f"Unexpected error in index_document_from_azure_datalake: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error_code": "UNEXPECTED_ERROR",
                "message": "An unexpected error occurred during document indexing",
                "details": {"error": str(e)}
            }
        )


@router.get(
    "/vectorstores/tokensNumber/{indexing_id}",
    response_model=IndexingTokens,
    status_code=status.HTTP_200_OK,
)
async def get_indexing_tokens_number(
        indexing_id: str,
        current_user: Annotated[User, Depends(get_current_active_user)],
):
    logger.info(f"Getting tokens for indexing_id: {indexing_id}")
    task_status = get_task_status(indexing_id)
    if task_status.status == "PENDING":
        logger.info(f"indexing_id: {indexing_id} is still pending")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{indexing_id} is pending.",
        )

    # Safe JSON parsing with proper error handling
    # Celery often returns Python repr strings with single quotes, None, True/False
    # We need to handle this by sanitizing before parsing
    try:
        if isinstance(task_status.result, dict):
            # Already a dict, use directly
            dict_result = task_status.result
        elif isinstance(task_status.result, str):
            # Try parsing as-is first (in case it's valid JSON)
            try:
                dict_result = json.loads(task_status.result)
            except json.JSONDecodeError:
                # Fallback: sanitize Python repr to JSON format
                # Replace single quotes with double quotes
                sanitized = task_status.result.replace("'", '"')
                # Replace Python None with JSON null
                sanitized = sanitized.replace('None', 'null')
                # Replace Python True/False with JSON true/false
                sanitized = sanitized.replace('True', 'true').replace('False', 'false')
                dict_result = json.loads(sanitized)
        else:
            # Convert to string and try sanitizing
            result_str = str(task_status.result)
            sanitized = result_str.replace("'", '"').replace('None', 'null')
            sanitized = sanitized.replace('True', 'true').replace('False', 'false')
            dict_result = json.loads(sanitized)
    except (json.JSONDecodeError, ValueError, TypeError) as e:
        logger.error("Failed to parse task result")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to parse task result",
        )

    try:
        # Try to get n_tokens from the result
        indexing_tokens = None

        # Check if n_tokens is at the top level
        if "n_tokens" in dict_result:
            indexing_tokens = dict_result["n_tokens"]
        # Check if n_tokens is nested in qdrant_index_result
        elif "qdrant_index_result" in dict_result and isinstance(dict_result["qdrant_index_result"], dict):
            qdrant_result = dict_result["qdrant_index_result"]
            if "n_tokens" in qdrant_result:
                indexing_tokens = qdrant_result["n_tokens"]

        if indexing_tokens is None:
            logger.info(f"indexing_tokens not found for indexing_id: {indexing_id}. Available keys: {list(dict_result.keys())}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="indexing_tokens not found",
            )
    except Exception as e:
        logger.error(f"Error extracting indexing_tokens: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to extract indexing_tokens: {str(e)}",
        )
    logger.info(f"indexing_tokens found for indexing_id: {indexing_id}, indexing_tokens: {indexing_tokens}")
    return IndexingTokens(indexing_tokens=indexing_tokens)

# for later ui usage (show users maybe : your doc is cached you can query now...)
@router.get("/vectorstores/document/status", status_code=200)
async def get_document_status(
    brain_id: str,
    external_id: str,
):
    """
    Get the indexing status of a document from Redis.

    This endpoint returns the current status of a document being indexed.
    Used by the UI to display real-time indexing progress

    Args:
        brain_id: Brain ID for the document
        external_id: External document ID

    Returns:
        Dictionary containing:
        - brain_id: Brain ID
        - external_id: External ID
        - status: Current status (IMPORTED, PENDING, COMPLETED, FAILED)
        - metrics: Optional metrics (vectorstore_name, indexed_docs, n_tokens, error, etc.)
        - created_at: When the document was first received
        - updated_at: Last update timestamp
    """
    import redis
    from src.redis_store.status import DocumentStatusRedis

    logger.info(f"Getting document status for brain_id={brain_id}, external_id={external_id}")

    redis_url = f"redis://{app_settings.REDIS_HOST}:{app_settings.REDIS_PORT}/{app_settings.REDIS_DB}"
    r = redis.from_url(redis_url, decode_responses=True)
    redis_store = DocumentStatusRedis(r)

    # Get status from Redis
    doc_status = redis_store.get_status(brain_id=brain_id, external_id=external_id)

    if doc_status is None:
        raise HTTPException(
            status_code=404,
            detail=f"Document status not found for brain_id={brain_id}, external_id={external_id}"
        )

    logger.info(f"Found document status: {doc_status.get('status')} for {external_id}")
    return doc_status


@router.post(
    "/vectorstores/vectorIds",
    response_model=List[dict],
    status_code=status.HTTP_200_OK,
    description="""This endpoint returns the vector ids using regular database query.""",
    summary="Get vector ids from vector store",
)
async def get_document_ids(
        vectorstore_query: VectorStoreQuery,
        current_user: Annotated[User, Depends(get_current_active_user)],
):
    logger.info(f"Vector IDs retrieval request for vectorstore: {vectorstore_query.vectorstore_name}")
    try:
        vectorstore_name = vectorstore_query.vectorstore_name
        brain_id = vectorstore_query.brain_id
        external_id = vectorstore_query.external_id
        image_analyzer = vectorstore_query.image_analyzer
        logger.info(f"Checking if vectorstore exists: {vectorstore_name}")

        filter_dict = {
            "brain_id": brain_id,
            "external_id": external_id,
        }
        filter_dict = {k: v for k, v in filter_dict.items() if v is not None}

        response = []

        query_results = query_collection_by_filter(
            collection_name=vectorstore_name,
            filter=filter_dict,
            include=["*"],
            exclude=["vector"]
        )
        ids: List[str] = [
            query_result["_id"]
            for query_result in query_results
        ]
        # Add main collection results to response
        response.append({
            "vectorstore_name": vectorstore_name,
            "data": VectorIds(vector_ids=ids)
        })

        return response

    except VectorstoreValidationError as e:
        logger.warning(f"Validation error in get_document_ids: {e.message}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error_code": e.error_code,
                "message": e.message,
                "details": e.details
            }
        )
    except VectorstoreSearchError as e:
        logger.exception(f"Search error in get_document_ids: {e.message}")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error_code": e.error_code,
                "message": e.message,
                "details": e.details
            }
        )
    except VectorstoreBaseException as e:
        logger.exception(f"Vectorstore error in get_document_ids: {e.message}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error_code": e.error_code,
                "message": e.message,
                "details": e.details
            }
        )
    except Exception as e:
        logger.exception(f"Unexpected error in get_document_ids: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error_code": "UNEXPECTED_ERROR",
                "message": "An unexpected error occurred during document ID retrieval",
                "details": {"error": str(e)}
            }
        )


@router.delete(
    "/vectorstores/vectorIds/V2",
    response_model=bool,
    status_code=status.HTTP_200_OK,
    summary="Delete documents from vector store",
    description="This endpoint deletes a document by its identifiers (brain_id, external_id)"
)
async def delete_vectorstore(
        vectorstore_query: VectorStoreQuery_ForDelete,
        current_user: Annotated[User, Depends(get_current_active_user)],
):
    try:
        env_value_vectorstore_name = app_settings.QDRANT_COLLECTION_NAME

        if not env_value_vectorstore_name:
            raise VectorstoreValidationError(
                message="QDRANT_COLLECTION_NAME environment variable is not set",
                field="QDRANT_COLLECTION_NAME",
            )

        vectorstore_name = env_value_vectorstore_name.strip().strip('"').strip("'")

        brain_id = vectorstore_query.brain_id
        external_id = vectorstore_query.external_id

        logger.info(f"Vector deletion request for vectorstore: {vectorstore_name}")

        filter_dict = {
            "brain_id": brain_id,
            "external_id": external_id,
        }

        # Remove None values
        filter_dict = {k: v for k, v in filter_dict.items() if v is not None}

        if not filter_dict:
            logger.warning("No valid filters provided for deletion.")
            return False

        qdrant_filter = dict_to_qdrant_filter(filter_dict)

        if not qdrant_filter:
            logger.warning("Generated Qdrant filter is empty.")
            return False

        client = get_qdrant_client()

        client.delete(
            collection_name=vectorstore_name,
            points_selector=qdrant_filter,
            wait=True,
        )

        logger.info("Documents deleted successfully using filter.")
        return True

    except VectorstoreValidationError as e:
        logger.warning(f"Validation error in get_document_ids: {e.message}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error_code": e.error_code,
                "message": e.message,
                "details": e.details
            }
        )
    except VectorstoreSearchError as e:
        logger.exception(f"Search error in get_document_ids: {e.message}")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error_code": e.error_code,
                "message": e.message,
                "details": e.details
            }
        )
    except VectorstoreBaseException as e:
        logger.exception(f"Vectorstore error in get_document_ids: {e.message}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error_code": e.error_code,
                "message": e.message,
                "details": e.details
            }
        )
    except Exception as e:
        logger.exception(f"Unexpected error in get_document_ids: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error_code": "UNEXPECTED_ERROR",
                "message": "An unexpected error occurred during document ID retrieval",
                "details": {"error": str(e)}
            }
        )


@router.delete(
    "/vectorstores/vectorIds",
    response_model=VectorIds,
    status_code=status.HTTP_200_OK,
    description="This endpoint deletes the vector using vector ids.",
    summary="Delete documents from vector store",
)
async def delete_documents_by_id(
        vectorstore_delete_by_id: VectorStoreDeleteById,
        current_user: Annotated[User, Depends(get_current_active_user)],
):
    logger.info(f"Vector deletion request for {len(vectorstore_delete_by_id.vector_ids)} documents")
    try:
        vectorstore_name = vectorstore_delete_by_id.vectorstore_name
        vector_ids = vectorstore_delete_by_id.vector_ids
        batch_size = 200

        for i in range(0, len(vector_ids), batch_size):
            batch = vector_ids[i:i + batch_size]
            await async_delete_by_ids(
                collection_name=vectorstore_name,
                ids=batch,
            )
            logger.info(f"Deleted documents with batch ids")

        return VectorIds(vector_ids=vector_ids)

    except VectorstoreValidationError as e:
        logger.warning(f"Validation error in delete_documents_by_id: {e.message}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error_code": e.error_code,
                "message": e.message,
                "details": e.details
            }
        )
    except VectorstoreDeletionError as e:
        logger.exception(f"Deletion error in delete_documents_by_id: {e.message}")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error_code": e.error_code,
                "message": e.message,
                "details": e.details
            }
        )
    except VectorstoreBaseException as e:
        logger.exception(f"Vectorstore error in delete_documents_by_id: {e.message}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error_code": e.error_code,
                "message": e.message,
                "details": e.details
            }
        )
    except Exception as e:
        logger.exception(f"Unexpected error in delete_documents_by_id: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error_code": "UNEXPECTED_ERROR",
                "message": "An unexpected error occurred during document deletion",
                "details": {"error": str(e)}
            }
        )


@router.get("/vectorstores/task/{task_id}", status_code=200, response_model=TaskStatus)
def get_task_status_route(
        task_id: str,
):
    """
    Get the status of a task
    """
    task = celery_app.AsyncResult(task_id)
    return TaskStatus(
        id=task_id,
        status=task.status,
        result=str(task.result),
    )


@router.post("/vectorstores/process_docs")
async def process_docs(request: ProcessRequest) -> Dict[str, Any]:
    logger.info(f"Document processing request for {len(request.paths)} documents")
    try:
        # Validate required fields
        if not request.paths or len(request.paths) == 0:
            raise VectorstoreValidationError(
                message="Document paths list is required and cannot be empty",
                field="paths",
                details={"provided_count": len(request.paths) if request.paths else 0}
            )

        if not request.webhook_url or not str(request.webhook_url).strip():
            raise VectorstoreValidationError(
                message="Webhook URL is required and cannot be empty",
                field="webhook_url",
                details={"provided_value": str(request.webhook_url)}
            )

        # 1. Download each PDF from Azure Data Lake in parallel
        download_tasks = [async_download_from_azure_datalake(p) for p in request.paths]
        local_paths = await asyncio.gather(*download_tasks)

        # 2. Load the text of each PDF
        all_pages = [load_pdf_pages(lp) for lp in local_paths]

        # 3. Extract attributes from each PDF using the dynamic specs
        extract_tasks = [
            extract_attributes(pages[: request.num_pages], request.attributes)
            for pages in all_pages
        ]
        attrs_list = await asyncio.gather(*extract_tasks)

        # 4. Build `docs_for_llm` with brain_id and doc_id
        docs_for_llm: List[Dict[str, Any]] = []
        for remote_path, attrs in zip(request.paths, attrs_list):
            brain_id, filename = remote_path.split('/', 1)
            doc_id = os.path.splitext(filename)[0]
            docs_for_llm.append({"brain_id": brain_id, "doc_id": doc_id, **attrs})

        # 5. Infer parent/child relationships
        relationships_raw = await generate_relationships(docs_for_llm)

        # 6. Assemble output payload
        docs_output = [
            {
                "doc_id": d["doc_id"],
                **{field: d.get(field) for field in [spec.name for spec in request.attributes]}
            }
            for d in docs_for_llm
        ]
        rel_output: List[Dict[str, str]] = []
        for d, rel in zip(docs_for_llm, relationships_raw):
            for target_id in rel.get("children", []):
                rel_output.append({
                    "brain": d["brain_id"],
                    "source": d["doc_id"],
                    "target": target_id,
                })

        payload = {"docs": docs_output, "relationships": rel_output, "metadata": request.metadata}

        async with aiohttp.ClientSession() as session:
            async with session.post(str(request.webhook_url), json=payload) as resp:
                if resp.status >= 400:
                    text = await resp.text()
                    raise VectorstoreWebhookError(
                        message=f"Webhook request failed with status {resp.status}",
                        webhook_operation="send_payload",
                        details={
                            "status_code": resp.status,
                            "response_text": text,
                            "webhook_url": str(request.webhook_url)
                        }
                    )

        return {"message": "Payload sent to webhook", "status_code": resp.status}

    except VectorstoreValidationError as e:
        logger.warning(f"Validation error in process_docs: {e.message}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error_code": e.error_code,
                "message": e.message,
                "details": e.details
            }
        )
    except VectorstoreWebhookError as e:
        logger.exception(f"Webhook error in process_docs: {e.message}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "error_code": e.error_code,
                "message": e.message,
                "details": e.details
            }
        )
    except VectorstoreBaseException as e:
        logger.exception(f"Vectorstore error in process_docs: {e.message}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error_code": e.error_code,
                "message": e.message,
                "details": e.details
            }
        )
    except Exception as e:
        logger.exception(f"Unexpected error in process_docs: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error_code": "UNEXPECTED_ERROR",
                "message": "An unexpected error occurred during document processing",
                "details": {"error": str(e)}
            }
        )


@router.post("/vectorstores/classify", response_model=PendingClassificationTask, status_code=status.HTTP_202_ACCEPTED)
async def classify_document(
        request: ClassifyDocumentRequest,
        current_user: Annotated[User, Depends(get_current_active_user)]
) -> PendingClassificationTask:
    """
    Classify a document by downloading it from Azure Data Lake.

    This endpoint downloads the file directly from Azure Data Lake,
    extracts text based on file type (PDF, Excel, PowerPoint, Word, or Text),
    and performs classification using LLM. The classification is executed
    asynchronously via Celery and results are sent via webhook if provided.

    Supported file formats:
    - PDF (.pdf)
    - Excel (.xlsx, .xls)
    - PowerPoint (.pptx, .ppt)
    - Word (.docx, .doc)
    - Text (.txt)

    The webhook payload will indicate whether the predicted category is new or existing
    through the `is_new_category` and `category_source` fields.

    Args:
        request: Classification request parameters containing file_path
        current_user: Authenticated user

    Returns:
        PendingClassificationTask: Task information for tracking classification progress
    """
    try:
        # Validate request
        if not request.file_path:
            raise VectorstoreValidationError(
                message="file_path is required",
                field="file_path"
            )

        # structure_template is optional and can be an empty array
        # The pydantic model already handles validation and defaults to []

        # Generate task ID for tracking
        task_id = str(uuid4())

        # Launch classification task
        from worker import classify_document_from_datalake_task

        celery_task = classify_document_from_datalake_task.delay(
            vectorstore_name=request.vectorstore_name,
            file_path=request.file_path,
            structure_template=request.structure_template,
            prompt=request.prompt,
            username=current_user.username,
            webhook_url=request.webhook_url,
            metadata=request.metadata,
            sheet_name=request.sheet_name
        )

        logger.info(f"Launched document classification task {celery_task.id} for file: {request.file_path}")

        # Return task information
        return PendingClassificationTask(
            classification_task_id=celery_task.id,
            status="queued",
            estimated_chunks=10  # Using field to indicate pages analyzed
        )

    except VectorstoreValidationError as e:
        logger.warning(f"Validation error in classify_document: {e.message}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error_code": e.error_code,
                "message": e.message,
                "details": e.details
            }
        )
    except Exception as e:
        logger.exception(f"Unexpected error in classify_document: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error_code": "UNEXPECTED_ERROR",
                "message": "An unexpected error occurred during document classification",
                "details": {"error": str(e)}
            }
        )


# ============================================================================
# Logical Indexing Endpoints
# ============================================================================

@router.post(
    "/vectorstores/logicalIndexing",
    response_model=LogicalIndexingResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Parse document structure (logical indexing)",
    description="""
    Parse a document's logical structure (headings, sections, TOC, blocks).

    This endpoint triggers asynchronous parsing of document structure using
    gRPC layout detection + PyMuPDF text extraction. Results are stored in
    PostgreSQL and can be retrieved using the GET endpoint.

    The logical indexing runs in parallel with vector indexing and provides:
    - Hierarchical document structure (sections, subsections)
    - Table of contents generation
    - Content block extraction (text, tables, images)
    - High-level document overview for RAG context injection

    Supported document types: PDF, images (converted to PDF first), Office documents.
    """,
)
async def logical_index_document(
    document: LogicalIndexingRequest,
    current_user: Annotated[User, Depends(get_current_active_user)]
) -> LogicalIndexingResponse:
    """
    Trigger logical document indexing.

    Request body:
    - file_path: Azure Data Lake path to the document
    - external_id: External document identifier
    - brain_id: Brain/workspace identifier
    - doc_id: Optional custom document ID (generated if not provided)
    """
    try:
        # Launch logical indexing task
        celery_task = celery_app.send_task(
            "logical-indexing.parse-document",
            kwargs={
                "file_path": document.file_path,
                "external_id": document.external_id,
                "brain_id": document.brain_id,
                "doc_id": document.doc_id,
                "source": document.source,
            },
            queue="logical-indexing",
        )

        logger.info(f"Launched logical indexing task {celery_task.id} for file: {document.file_path}")

        return LogicalIndexingResponse(
            task_id=celery_task.id,
            status="queued",
            message=f"Logical indexing task queued for {document.external_id}",
        )
    except Exception as e:
        logger.exception(f"Unexpected error in logical_index_document: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error_code": "UNEXPECTED_ERROR",
                "message": "An unexpected error occurred during logical indexing",
                "details": {"error": str(e)}
            }
        )


@router.get(
    "/vectorstores/logicalIndexing/{external_id}",
    summary="Get logical indexing result",
    description="""
    Retrieve the logical indexing result for a document.

    Returns the parsed document structure including:
    - Overview: High-level document summary
    - TOC: Table of contents
    - Blocks: All content blocks (text, tables, etc.)
    - Sections: Hierarchical document structure
    """,
)
async def get_logical_indexing_result(
    external_id: str,
    brain_id: str,
    current_user: Annotated[User, Depends(get_current_active_user)]
) -> Dict[str, Any]:
    """
    Get logical indexing result by external_id and brain_id.
    """
    from src.modules.logical_indexing.tasks import get_logical_indexing_result as get_result

    try:
        result = get_result(external_id=external_id, brain_id=brain_id)

        if result is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Logical indexing result not found for external_id={external_id}, brain_id={brain_id}"
            )

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Unexpected error in get_logical_indexing_result: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error_code": "UNEXPECTED_ERROR",
                "message": "An unexpected error occurred while retrieving logical indexing result",
                "details": {"error": str(e)}
            }
        )


@router.delete(
    "/vectorstores/logicalIndexing/{external_id}",
    summary="Delete logical indexing result",
    description="Delete the logical indexing result for a document from PostgreSQL.",
)
async def delete_logical_indexing_result(
    external_id: str,
    brain_id: str,
    current_user: Annotated[User, Depends(get_current_active_user)]
) -> Dict[str, Any]:
    """
    Delete logical indexing result by external_id and brain_id.
    """
    from src.modules.logical_indexing.tasks import delete_logical_indexing_result as delete_result

    try:
        deleted = delete_result(external_id=external_id, brain_id=brain_id)

        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Logical indexing result not found for external_id={external_id}, brain_id={brain_id}"
            )

        return {
            "status": "deleted",
            "external_id": external_id,
            "brain_id": brain_id,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Unexpected error in delete_logical_indexing_result: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error_code": "UNEXPECTED_ERROR",
                "message": "An unexpected error occurred while deleting logical indexing result",
                "details": {"error": str(e)}
            }
        )
