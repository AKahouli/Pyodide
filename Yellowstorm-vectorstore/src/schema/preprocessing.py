from typing import List

from pydantic import BaseModel, Field

from src.modules.document_model import DocumentModel


class SplitTextRequest(BaseModel):
    documents: List[DocumentModel] = Field(..., title="Documents", description="Documents to split")
    chunk_size: int = Field(
        1200,
        title="Chunk Size",
        description="Size of the chunks to split the documents into",
    )
    chunk_overlap: int = Field(0, title="Chunk Overlap", description="Size of the overlap between chunks")
    separators: List[str] = Field(
        ["\n\n", "\n", " "],
        title="Separators",
        description="Separators to split the documents on",
    )
    keep_separator: bool = Field(
        True,
        title="Keep Separator",
        description="Whether to keep the separator in the chunk",
    )
    keep_order: bool = Field(
        False,
        title="Keep Order",
        description="Whether to add a field to the metadata to keep track of the order of the chunks",
    )
