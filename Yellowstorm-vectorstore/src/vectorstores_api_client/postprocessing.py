from typing import List, Optional
from asyncio import to_thread
from typing import List, Optional

from langchain_core.documents import Document

from src.modules.document_model import (
    langchain_document_to_document_model,
)
from src.modules.same_document_title import concatenate_documents, documents_with_the_same_title
from src.schema.document_model import DocumentModel


def dict_to_document(doc_dict: dict) -> Document:
    """
    Convert a dictionary to a Document object.

    Parameters
    ----------
    doc_dict : dict
        The dictionary representation of a document.

    Returns
    -------
    Document
        The Document object.
    """
    return Document(
        page_content=doc_dict['page_content'],
        metadata=doc_dict['metadata'],
    )


def document_to_document_model(document: Document) -> DocumentModel:
    """
    Convert a Document to a DocumentModel.

    Parameters
    ----------
    document : Document
        The document

    Returns
    -------
    DocumentModel
        The document model

    """
    return DocumentModel(
        page_content=document.page_content,
        metadata=document.metadata,
    )


def get_documents_of_the_same_title_sync(
        documents: List[DocumentModel],
        collection_name: str,
        query: str,
) -> List[DocumentModel]:
    """
    Retrieves and reorders documents from the same collection based on their titles.

    This function processes a list of `DocumentModel` objects, grouping and reordering them by their titles.
    Documents without titles or external IDs are included as-is. Documents with titles and external IDs are
    grouped, sorted by their metadata's "chunk_order" field, concatenated, and transformed into `DocumentModel` objects.

    Args:
        documents (List[DocumentModel]): A list of `DocumentModel` objects to process.
        collection_name (str): The name of the collection from which to retrieve documents with the same title.
        query(str): to be removed
    Returns:
        List[DocumentModel]: A list of reordered `DocumentModel` objects, with documents grouped and concatenated based on their titles.
    """
    results: List[DocumentModel] = []
    for document in documents:
        title = document.metadata.get("title", "No Title")
        external_id = document.metadata.get("external_id", None)
        if title == "No Title" or external_id is None:
            results.append(document)
        else:

            documents = documents_with_the_same_title(
                collection_name,
                title,
                external_id)
            documents.sort(key=lambda doc: doc.metadata["chunk_order"])
            concatenated_document = concatenate_documents(documents)
            document_model = langchain_document_to_document_model(concatenated_document)
            results.append(document_model)
    return results


async def get_documents_of_the_same_title(
        documents: List[DocumentModel],
        collection_name: str,
        query: str,
) -> List[DocumentModel]:
    """
    Get documents of the same title.

    Parameters
    ----------
    documents : List[DocumentModel]
        The documents
    collection_name : str
        The name of the collection
    query : dict
        Dict of query

    Returns
    -------
    List[DocumentModel]
        The reordered documents

    """
    results: List[DocumentModel] = []
    for document in documents:
        title = document.metadata.get("title", "No Title")
        external_id = document.metadata.get("external_id", None)
        if title == "No Title" or external_id is None:
            results.append(document)
        else:

            documents = await to_thread(documents_with_the_same_title,
                                        collection_name,
                                        title,
                                        external_id)
            documents.sort(key=lambda doc: doc.metadata["chunk_order"])
            concatenated_document = concatenate_documents(documents)
            document_model = langchain_document_to_document_model(concatenated_document)
            results.append(document_model)
    return results
