"""This module contains functions for indexing documents into Qdrant."""

from typing import Any, Dict, List, Optional

from langchain_core.documents import Document

from more_itertools import chunked
from src.modules.indexing.files_classification.similarity_classification import DocumentClassifier
from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.modules.qdrant_search.get_qdrant_collection import get_qdrant_client, get_qdrant_collection
from src.modules.num_tokens import num_tokens_from_string
from src.schema.fastapi.vectorstores.requests import (
    VectorstoreValidationError,
    VectorstoreIndexingError,
    VectorstoreConnectionError
)

logger = get_logger(__name__)
settings = get_settings()


def add_documents_with_classification(
    index_name: str,
    documents: List[Document],
    directories: List[str],
    external_id: str,
    user_id: Optional[str] = "unknown",
    classification_enabled: bool = False,
    include_images: bool = False,
) -> Dict[str, Any]:
    """
    Version modifiée de add_documents avec classification intégrée

    Parameters
    ----------
    index_name : str
        Name of the index/collection in Qdrant to index into
    documents : List[Document]
        List of documents to index
    directories : List[str]
        Liste des titres de répertoires disponibles pour la classification
    user_id : Optional[str]
        User ID pour l'indexation
    classification_enabled : bool
        Active ou désactive la classification
    include_images : bool
        Indique si les images doivent être prises en compte dans la classification

    Returns
    -------
    Dict[str, Any]
        Dictionary containing the IDs, number of tokens, and classification results
    """
    # Validation des entrées (reprise du code original)
    if not index_name or not index_name.strip():
        raise VectorstoreValidationError(
            message="Index name is required and cannot be empty",
            field="index_name",
            details={"provided_value": index_name},
        )

    if not documents:
        raise VectorstoreValidationError(
            message="Documents list cannot be empty",
            field="documents",
            details={"provided_count": len(documents) if documents else 0},
        )

    try:
        logger.info(f"Adding {len(documents)} documents to {index_name}")
        n_tokens = sum([num_tokens_from_string(document.page_content) for document in documents])
        logger.info(f"Total number of tokens: {n_tokens}")

        # Remove azure_id from document metadata if present (legacy Azure Search field)
        for doc in documents:
            if "azure_id" in doc.metadata:
                del doc.metadata["azure_id"]
            if "id" in doc.metadata and doc.metadata.get("_source") == "azure_vector":
                # Remove legacy Azure Search ID field
                del doc.metadata["id"]

        try:
            qdrant_collection = get_qdrant_collection(index_name,user_id)
            # Get the raw Qdrant client for custom payload structure
            from src.modules.qdrant_search.get_qdrant_collection import add_documents_batch_to_qdrant
        except Exception as e:
            raise VectorstoreConnectionError(
                message=f"Failed to connect to Qdrant collection: {index_name}",
                connection_target="qdrant_collection",
                details={"index_name": index_name, "error": str(e)}
            )

        all_ids = []
        try:
            for batch_num, batch in enumerate(chunked(documents, 500)):
                try:
                    # Use custom function to add documents with {page_content, metadata, type} structure
                    ids = add_documents_batch_to_qdrant(index_name, batch, user_id)
                    all_ids.extend(ids)
                    logger.info(f"Successfully added batch {batch_num + 1} with {len(ids)} documents")
                except Exception as e:
                    raise VectorstoreIndexingError(
                        message=f"Failed to add document batch {batch_num + 1} to index",
                        indexing_operation="add_document_batch",
                        details={
                            "index_name": index_name,
                            "batch_number": batch_num + 1,
                            "batch_size": len(batch),
                            "error": str(e)
                        }
                    )

        except VectorstoreIndexingError:
            # Re-raise indexing errors as-is
            raise
        except Exception as e:
            raise VectorstoreIndexingError(
                message=f"Unexpected error during document indexing",
                indexing_operation="batch_processing",
                details={"index_name": index_name, "total_documents": len(documents), "error": str(e)}
            )

        logger.info(f"Added {len(all_ids)} documents to {index_name}")

        # Wait for Qdrant to index the documents before classification
        import time
        logger.info("Waiting 5 seconds for Qdrant to complete indexing...")
        time.sleep(5)
        logger.info("Resume classification after indexing delay")

        # classification
        classification_result = {}
        if classification_enabled:
            classifier = DocumentClassifier(index_name, directories, external_id, user_id)
            classification_result = classifier.classify_chunks_with_qdrant(all_ids, include_images)
            logger.info(
                f"Classification completed."
            )

        result = {
            "ids": all_ids,
            "n_tokens": n_tokens,
            "classifications": classification_result if classification_enabled else {}
        }

        logger.info(f"Result: {result}")
        return result

    except Exception as e:
        logger.error(f"Error in add_documents_with_classification: {str(e)}")
        raise VectorstoreIndexingError(
            message=f"Unexpected error adding documents with classification to index: {index_name}",
            indexing_operation="add_documents_with_classification",
            details={
                "index_name": index_name,
                "document_count": len(documents),
                "error": str(e),
            },
        )


def add_documents(index_name: str, documents: List[Document], user_id:Optional[str]="unknown") -> Dict[str, Any]:
    """
    Index documents into Qdrant in batches of 500
    Note: It is assumed that the documents have already been split

    Parameters
    ----------
    index_name : str
        Name of the index/collection in Qdrant to index into
    documents : List[Document]
        List of documents to index

    Returns
    -------
    Dict[str, Any]
        Dictionary containing the IDs of the documents and the number of tokens
    """
    # Validate inputs
    if not index_name or not index_name.strip():
        raise VectorstoreValidationError(
            message="Index name is required and cannot be empty",
            field="index_name",
            details={"provided_value": index_name}
        )
    
    if not documents:
        raise VectorstoreValidationError(
            message="Documents list cannot be empty",
            field="documents",
            details={"provided_count": len(documents) if documents else 0}
        )
    
    if not isinstance(documents, list):
        raise VectorstoreValidationError(
            message="Documents must be a list",
            field="documents",
            details={"provided_type": type(documents).__name__}
        )
    
    # Validate document content
    for i, doc in enumerate(documents):
        if not isinstance(doc, Document):
            raise VectorstoreValidationError(
                message=f"All documents must be Document instances",
                field="documents",
                details={"document_index": i, "provided_type": type(doc).__name__}
            )
        
        if not doc.page_content or not doc.page_content.strip():
            raise VectorstoreValidationError(
                message=f"Document content cannot be empty",
                field="documents",
                details={"document_index": i, "content": doc.page_content}
            )
    
    try:
        logger.info(f"Adding {len(documents)} documents to {index_name}")
        n_tokens = sum([num_tokens_from_string(document.page_content) for document in documents])
        logger.info(f"Total number of tokens: {n_tokens}")

        # Remove azure_id from document metadata if present (legacy Azure Search field)
        for doc in documents:
            if "azure_id" in doc.metadata:
                del doc.metadata["azure_id"]
            if "id" in doc.metadata and doc.metadata.get("_source") == "azure_vector":
                # Remove legacy Azure Search ID field
                del doc.metadata["id"]

        try:
            qdrant_instance = get_qdrant_collection(index_name,user_id)
            # Get the raw Qdrant client for custom payload structure
            from src.modules.qdrant_search.get_qdrant_collection import add_documents_batch_to_qdrant
        except Exception as e:
            raise VectorstoreConnectionError(
                message=f"Failed to connect to Qdrant AI Search collection: {index_name}",
                connection_target="qdrant_instance",
                details={"index_name": index_name, "error": str(e)}
            )

        all_ids = []
        try:
            for batch_num, batch in enumerate(chunked(documents, 500)):
                try:
                    # Use custom function to add documents with {page_content, metadata, type} structure
                    ids = add_documents_batch_to_qdrant(index_name, batch, user_id)
                    all_ids.extend(ids)
                    logger.info(f"Successfully added batch {batch_num + 1} with {len(ids)} documents")
                except Exception as e:
                    raise VectorstoreIndexingError(
                        message=f"Failed to add document batch {batch_num + 1} to index",
                        indexing_operation="add_document_batch",
                        details={
                            "index_name": index_name,
                            "batch_number": batch_num + 1, 
                            "batch_size": len(batch),
                            "error": str(e)
                        }
                    )
                    
        except VectorstoreIndexingError:
            # Re-raise indexing errors as-is
            raise
        except Exception as e:
            raise VectorstoreIndexingError(
                message=f"Unexpected error during document indexing",
                indexing_operation="batch_processing",
                details={"index_name": index_name, "total_documents": len(documents), "error": str(e)}
            )
        
        logger.info(f"Added {len(all_ids)} documents to {index_name}")
        result = {"ids": all_ids, "n_tokens": n_tokens}
        logger.info(f"Result: {result}")
        return result
        
    except VectorstoreValidationError:
        # Re-raise validation errors as-is
        raise
    except (VectorstoreIndexingError, VectorstoreConnectionError):
        # Re-raise custom errors as-is
        raise  
    except Exception as e:
        # Catch any other unexpected errors
        raise VectorstoreIndexingError(
            message=f"Unexpected error adding documents to index: {index_name}",
            indexing_operation="add_documents",
            details={"index_name": index_name, "document_count": len(documents), "error": str(e)}
        )


def add_documents_simple(
    index_name: str,
    documents: List[Document],
    external_id: Optional[str] = None,
    user_id: Optional[str] = "unknown",
    include_images: bool = False,
    delete_after: bool = False,
    batch_size: int = 200,
) -> Dict[str, Any]:
    """
    Add documents to vector store without classification.

    This is a simplified version of add_documents_with_classification that removes
    all classification logic while maintaining the same interface for compatibility.

    Parameters
    ----------
    index_name : str
        Name of the index to add documents to
    documents : List[Document]
        List of documents to add
    external_id : Optional[str]
        External ID for tracking purposes
    user_id : Optional[str]
        User ID making the request
    include_images : bool
        Whether to include image processing (for compatibility, not used in this function)
    delete_after : bool
        Whether to delete documents after adding (for compatibility, not used)
    batch_size : int
        Batch size for processing documents

    Returns
    -------
    Dict[str, Any]
        Dictionary containing:
        - ids: List of document IDs
        - n_tokens: Total number of tokens processed
    """
    # Use the existing add_documents function which already handles the core functionality
    result = add_documents(
        index_name=index_name,
        documents=documents,
        user_id=user_id
    )

    # Log external_id if provided for tracking
    if external_id:
        logger.info(f"Documents indexed for external_id: {external_id}")

    return result


def verify_qdrant_indexing(
    collection_name: str,
    external_id: str,
    expected_count: int,
    user_id: str = "unknown",
    max_retries: int = 3,
    retry_delay: int = 2,
) -> bool:
    """Verify that documents are indexed in Qdrant.

    Args:
        collection_name: Name of the Qdrant collection
        external_id: External document ID to verify
        expected_count: Expected number of documents
        user_id: User ID for collection access
        max_retries: Maximum number of verification retries
        retry_delay: Delay between retries in seconds

    Returns:
        True if verification succeeds, False otherwise
    """
    import time

    for attempt in range(max_retries):
        try:
            from qdrant_client.models import Filter, FieldCondition, MatchValue

            client = get_qdrant_client()

            # Query Qdrant for documents with this external_id
            filter_condition = Filter(
                must=[
                    FieldCondition(
                        key="metadata.external_id",
                        match=MatchValue(value=external_id),
                    )
                ]
            )

            result = client.count(
                collection_name=collection_name,
                count_filter=filter_condition,
            )

            found_count = result.count
            logger.info(
                f"Qdrant verification attempt {attempt + 1}/{max_retries}: "
                f"expected {expected_count}, found {found_count} for external_id={external_id}"
            )

            if found_count >= expected_count:
                logger.info(f"✅ Qdrant verification succeeded: {found_count} documents found")
                return True

            if attempt < max_retries - 1:
                logger.warning(
                    f"Expected {expected_count} documents but found {found_count}. "
                    f"Retrying in {retry_delay}s..."
                )
                time.sleep(retry_delay)

        except Exception as e:
            if attempt < max_retries - 1:
                logger.warning(
                    f"Qdrant verification attempt {attempt + 1} failed: {e}. "
                    f"Retrying in {retry_delay}s..."
                )
                time.sleep(retry_delay)
            else:
                logger.error(f"❌ Qdrant verification failed after {max_retries} attempts: {e}")

    logger.error(
        f"❌ Qdrant verification failed for external_id={external_id} "
        f"(expected {expected_count}, not found after {max_retries} retries)"
    )
    return False
