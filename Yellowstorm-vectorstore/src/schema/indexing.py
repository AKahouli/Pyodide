"""Schema for indexing request."""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, root_validator

from .chunk_style import ChunkStyle


class SplittingParameters(BaseModel):
    chunk_size: int = Field(1200, description="The size of the chunks to split the document into")
    chunk_overlap: int = Field(0, description="The overlap between chunks (must be smaller than chunk_size)")
    separators: List[str] = Field(["\n\n", "\n", " ", ""], description="List of separators to split the document on")
    keep_separator: bool = Field(True, description="Keep the separator when splitting the document")

    @root_validator(pre=True)
    def check_chunk_overlap(cls, values):
        """
        Check chunk overlap
        """
        chunk_size = values.get("chunk_size")
        chunk_overlap = values.get("chunk_overlap")
        if chunk_overlap >= chunk_size:
            raise ValueError("chunk_overlap must be smaller than chunk_size")
        return values


class AzureIndexingRequest(BaseModel):
    collection_name: str = Field("default", description="The name of the collection to index the document in")
    splitting_parameters: SplittingParameters = Field(..., description="Parameters for splitting the document")
    file_path: str = Field(..., description="The path of the file to index in Azure Data Lake")
    metadata: Dict[str, Any] = Field({}, description="Metadata to add to the document")
    use_ocr: bool = Field(False, description="Whether to use OCR to extract text from images in the PDF")
    save_images: bool = Field(False, description="Whether to save images extracted from the PDF")
    enable_style_aware_chunking: bool = Field(
        False, description="Whether to enable style-aware chunking (only works for .pdf files)"
    )
    chunk_styles: Optional[List[ChunkStyle]] = Field(
        None,
        description="The chunk styles to use for style-aware chunking, only required if enable_style_aware_chunking is True",
    )
    brain_type: str = Field("doc", description="The type of brain to use for indexing",examples=["doc"])
    brain_id: str = Field(
    ...,
    title="Brain ID of the document index",
    description="Brain ID of the document index. This brain ID could be later used for hybrid search in the vector database.",
    examples=["brain1"],
    )
    image_description: Optional[bool] = Field(False, description="Whether to generate a description for images process in the PDF",examples=[False])


     

    @root_validator(pre=True)
    def check_enable_style_aware_chunking(cls, values):
        """
        Check enable style aware chunking
        """
        enable_style_aware_chunking = values.get("enable_style_aware_chunking")
        file_path = values.get("file_path")
        if enable_style_aware_chunking and not file_path.endswith(".pdf"):
            raise ValueError("enable_style_aware_chunking can only be enabled for .pdf files")
        return values

    @root_validator(pre=True)
    def check_chunk_styles(cls, values):
        """
        Check chunk styles
        """
        enable_style_aware_chunking = values.get("enable_style_aware_chunking")
        chunk_styles = values.get("chunk_styles")
        if enable_style_aware_chunking and chunk_styles is None:
            raise ValueError("chunk_styles must be provided if enable_style_aware_chunking is True")
        return values
