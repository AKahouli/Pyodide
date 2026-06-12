import asyncio
import shutil
from typing import List

from src.modules.qdrant_search.delete import delete_qdrant_documents_by_ids

from src.schema.fastapi.vectorstores.requests import (
    VectorstoreValidationError,
    VectorstoreDeletionError
)


async def async_delete_by_ids(
        collection_name: str,
        ids: List[str],
):
    """
    Delete documents by IDs

    Parameters
    ----------
    collection_name : str
        The name of the collection
    ids : List[str]
        The IDs of the documents to delete
    """
    # Validate inputs
    if not collection_name or not collection_name.strip():
        raise VectorstoreValidationError(
            message="Collection name is required and cannot be empty",
            field="collection_name",
            details={"provided_value": collection_name}
        )
    
    if not ids or len(ids) == 0:
        raise VectorstoreValidationError(
            message="IDs list is required and cannot be empty",
            field="ids",
            details={"provided_count": len(ids) if ids else 0}
        )
    
    try:
        await asyncio.to_thread(
            delete_qdrant_documents_by_ids,
            collection_name,
            ids,
        )
        return "OK"
    except Exception as e:
        raise VectorstoreDeletionError(
            message=f"Failed to delete documents from collection '{collection_name}'",
            deletion_operation="delete_by_ids",
            details={
                "collection_name": collection_name,
                "ids_count": len(ids),
                "error": str(e)
            }
        )
async def delete_directory(directory_path):
    # Use asyncio.to_thread to run the blocking operation in a separate thread
    await asyncio.to_thread(shutil.rmtree, directory_path)
