"""Delete functions for Qdrant operations."""

from typing import List

from qdrant_client.models import Filter, FieldCondition, MatchAny

from src.logger.logging import get_logger
from .get_qdrant_collection import get_qdrant_client

logger = get_logger(__name__)


def delete_qdrant_documents_by_ids(
    collection_name: str,
    ids: List[str],
) -> None:
    """Delete documents from a Qdrant collection by IDs.

    Parameters
    ----------
    collection_name : str
        Name of the collection to delete from
    ids : List[str]
        List of IDs of the documents to delete

    Raises
    ------
    Exception
        If the deletion operation fails
    """
    logger.info(f"Deleting {len(ids)} documents from Qdrant collection {collection_name}")

    client = get_qdrant_client()

    try:
        client.delete(
            collection_name=collection_name,
            points_selector=ids,
        )
        logger.info(f"Successfully deleted {len(ids)} documents from {collection_name}")
    except Exception as e:
        logger.error(f"Error deleting documents from {collection_name}: {str(e)}")
        raise


def delete_qdrant_documents_by_filter(
    collection_name: str,
    field_name: str,
    field_values: List[str],
) -> None:
    """Delete documents from a Qdrant collection by field filter.

    Parameters
    ----------
    collection_name : str
        Name of the collection to delete from
    field_name : str
        Name of the field to filter on (e.g., 'external_id', 'brain_id')
    field_values : List[str]
        List of values to match for deletion

    Raises
    ------
    Exception
        If the deletion operation fails
    """
    logger.info(
        f"Deleting documents from {collection_name} where {field_name} in {field_values}"
    )

    client = get_qdrant_client()

    try:
        filter_condition = Filter(
            must=[
                FieldCondition(
                    key=field_name,
                    match=MatchAny(any=field_values),
                )
            ]
        )

        client.delete(
            collection_name=collection_name,
            points_selector=filter_condition,
        )
        logger.info(
            f"Successfully deleted documents from {collection_name} with {field_name}={field_values}"
        )
    except Exception as e:
        logger.error(f"Error deleting documents by filter from {collection_name}: {str(e)}")
        raise


def delete_qdrant_documents_by_external_id(
    collection_name: str,
    external_id: str,
) -> None:
    """Delete all documents with a specific external_id.

    Parameters
    ----------
    collection_name : str
        Name of the collection to delete from
    external_id : str
        External ID to match for deletion

    Raises
    ------
    Exception
        If the deletion operation fails
    """
    logger.info(f"Deleting documents from {collection_name} with external_id={external_id}")
    delete_qdrant_documents_by_filter(collection_name, "external_id", [external_id])


def delete_qdrant_documents_by_brain_id(
    collection_name: str,
    brain_id: str,
) -> None:
    """Delete all documents with a specific brain_id.

    Parameters
    ----------
    collection_name : str
        Name of the collection to delete from
    brain_id : str
        Brain ID to match for deletion

    Raises
    ------
    Exception
        If the deletion operation fails
    """
    logger.info(f"Deleting documents from {collection_name} with brain_id={brain_id}")
    delete_qdrant_documents_by_filter(collection_name, "metadata.brain_id", [brain_id])