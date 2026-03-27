from typing import List

from langchain.schema import Document

from src.logger.logging import get_logger
from src.modules.qdrant_search.querying import query_qdrant_search_index

logger = get_logger(__name__)


def documents_with_the_same_title(collection_name: str, title: str, external_id: str) -> List[Document]:
    """
    Query the collection.

    Parameters
    ----------
    collection_name : str
        The name of the collection
    title : str
        The title
    external_id : str
        The external id

    Returns
    -------
    List[Document]
        The documents with the same title

    """
    filter_dict = {"title": title, "external_id": external_id}
    logger.info(f"Querying documents with the same title as {title}")
    logger.debug(f"Collection name: {collection_name}, Filter: {filter_dict}")

    results = query_qdrant_search_index(
        collection_name=collection_name,
        filter=filter_dict,
    )

    # Convert results to Langchain Documents
    documents = []
    for result in results:
        source = result.get("_source", {})
        documents.append(
            Document(
                page_content=source.get("text", ""),
                metadata=source.get("metadata", {}),
            )
        )

    logger.info(f"Found {len(documents)} documents with the same title as {title}")
    return documents


def concatenate_documents(documents: List[Document]) -> Document:
    """
    Concatenate documents.

    Parameters
    ----------
    documents : List[Document]
        The documents

    Returns
    -------
    Document
        The concatenated document
    """
    concatenated_metadata = {}
    logger.info(f"Concatenating {len(documents)}")
    logger.debug(f"Documents: {documents}")
    for document in documents:
        concatenated_metadata.update(document.metadata)

    concatenated_document = Document(
        page_content=" ".join([document.page_content for document in documents]),
        metadata=concatenated_metadata,
    )
    return concatenated_document