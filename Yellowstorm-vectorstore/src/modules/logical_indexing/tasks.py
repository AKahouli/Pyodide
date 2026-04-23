"""
Celery tasks for logical document indexing.

This module provides a standalone Celery task for parsing document structure
using gRPC layout detection + PyMuPDF text extraction. Results are stored
in PostgreSQL for later retrieval.
"""

import os
import shutil
import time
import uuid
from typing import Any, Dict, List, Optional

from PIL import Image
from langcodes import Language

from src.config.settings import get_settings
from src.db.models import LogicalDocument, LogicalBlock, LogicalSection, LogicalImage
from src.db.session import get_db_session_sync
from src.logger.logging import get_logger
from src.modules.datalake import (
    download_from_azure_datalake,
    convert_file_to_pdf_and_upload,
    upload_to_azure_datalake,
)
from src.modules.indexing.image_index import (
    convert_pdf_to_images,
    extract_sub_image,
    describe_image,
)
from src.modules.indexing.image_compression import create_compressed_image
from src.modules.logical_indexing.layout_pymupdf_pipeline import LayoutPyMuPDFPipeline
from src.modules.logical_indexing.doc_outline_v2 import (
    compile_document,
    high_level_overview,
    sanitize_text,
    _assign_images_to_sections,
)
from src.modules.embeddings import get_embeddings

logger = get_logger(__name__)
settings = get_settings()


def _normalize_embedding(vector: List[float]) -> List[float]:
    return [float(value) for value in vector]


LAYOUT_DPI = 144
CROP_DPI = 300
_DPI_SCALE = CROP_DPI / LAYOUT_DPI


def _resolve_language_name(language: str) -> str:
    try:
        return Language.make(language=language).display_name()
    except Exception:
        return language


def _validate_and_get_page_image(
    img_block: Any,
    page_image_paths: List[str],
    scale: float,
) -> Optional[tuple[str, dict[str, float]]]:
    """Validate image block and return (page_image_path, scaled_bbox) or None."""
    if not img_block.bbox or len(img_block.bbox) < 4:
        logger.warning(f"Skipping image {img_block.id}: no bbox or bbox < 4 elements")
        return None

    page_idx = img_block.page
    page_image_path = (
        page_image_paths[page_idx]
        if page_idx < len(page_image_paths)
        else None
    )
    if not page_image_path or not os.path.exists(page_image_path):
        logger.warning(
            f"Skipping image {img_block.id}: page image not found "
            f"(page_idx={page_idx}, total_pages={len(page_image_paths)}, "
            f"path={page_image_path})"
        )
        return None

    scaled_bbox = {
        "x1": img_block.bbox[0] * scale,
        "y1": img_block.bbox[1] * scale,
        "x2": img_block.bbox[2] * scale,
        "y2": img_block.bbox[3] * scale,
    }
    return page_image_path, scaled_bbox


def _process_single_image(
    local_crop_path: str,
    datalake_directory: str,
    language_name: str,
    user_id: str,
    img_block: Any,
    image_to_section: dict[str, str],
) -> Dict[str, Any]:
    """Compress, upload, and describe a single cropped image. Returns result dict."""
    compressed_path = create_compressed_image(local_crop_path)

    original_filename = os.path.basename(local_crop_path)
    datalake_original = f"{datalake_directory}/{original_filename}"
    upload_to_azure_datalake(local_crop_path, datalake_original)

    datalake_compressed = None
    if compressed_path:
        compressed_filename = os.path.basename(compressed_path)
        datalake_compressed = f"{datalake_directory}/{compressed_filename}"
        upload_to_azure_datalake(compressed_path, datalake_compressed)

    image_path_for_desc = compressed_path if compressed_path else local_crop_path
    description = describe_image(image_path_for_desc, language_name, user_id)

    dimensions = {"width": 0, "height": 0}
    try:
        with Image.open(local_crop_path) as img:
            dimensions = {"width": img.size[0], "height": img.size[1]}
    except Exception:
        pass

    return {
        "image_id": img_block.id,
        "section_id": image_to_section.get(img_block.id),
        "label": img_block.label,
        "description": description,
        "image_path": datalake_original,
        "image_compressed_path": datalake_compressed,
        "bbox": {
            "x1": img_block.bbox[0], "y1": img_block.bbox[1],
            "x2": img_block.bbox[2], "y2": img_block.bbox[3],
        },
        "page_number": img_block.page,
        "dimensions": dimensions,
    }


def _process_images_for_document(
    compiled_doc: Any,
    pdf_path: str,
    temp_folder: str,
    datalake_directory: str,
    language: str,
    user_id: str = "unknown",
) -> List[Dict[str, Any]]:
    """Extract, compress, upload and describe images from the document.

    Reuses utilities from the old image indexation pipeline:
    convert_pdf_to_images -> extract_sub_image ->
    create_compressed_image -> upload_to_azure_datalake -> describe_image
    """
    if not compiled_doc.images:
        return []

    language_name = _resolve_language_name(language)

    page_images_dir = os.path.join(temp_folder, "page_images")
    os.makedirs(page_images_dir, exist_ok=True)
    page_image_paths = convert_pdf_to_images(pdf_path, page_images_dir, dpi=300, image=True)
    logger.info(f"Converted PDF to {len(page_image_paths)} page images at 300 DPI")

    image_to_section = _assign_images_to_sections(
        list(compiled_doc.images.values()),
        list(compiled_doc.blocks.values()),
    )

    crops_dir = os.path.join(temp_folder, "image_crops")
    os.makedirs(crops_dir, exist_ok=True)

    file_id = os.path.splitext(os.path.basename(pdf_path))[0]
    cropped_images: List[Dict[str, Any]] = []

    for img_block in compiled_doc.images.values():
        logger.info(
            f"Processing image block {img_block.id}: page={img_block.page}, "
            f"bbox={img_block.bbox}, label={img_block.label}"
        )

        validation = _validate_and_get_page_image(img_block, page_image_paths, _DPI_SCALE)
        if validation is None:
            continue
        page_image_path, scaled_bbox = validation

        logger.info(f"Scaled bbox for {img_block.id}: {scaled_bbox}")

        sub_images = extract_sub_image(
            page_image_path,
            [scaled_bbox],
            img_block.page,
            crops_dir,
            file_id,
        )
        logger.info(f"Extracted {len(sub_images)} sub-images for {img_block.id}")

        for local_crop_path in sub_images:
            logger.info(f"Processing sub-image {local_crop_path} for {img_block.id}")
            img_data = _process_single_image(
                local_crop_path, datalake_directory, language_name, user_id,
                img_block, image_to_section,
            )
            cropped_images.append(img_data)

    return cropped_images


def _parse_document_logical(
    file_path: str,
    external_id: str,
    brain_id: str,
    doc_id: Optional[str] = None,
    local_file_path: Optional[str] = None,
    source: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Parse document structure using gRPC layout detection + PyMuPDF.

    This implementation can either:
    1. Use a local file path already produced by an upstream chain task, or
    2. Download the document from Azure Data Lake and convert non-PDF files
    3. Parses document structure using LayoutPyMuPDFPipeline
    4. Stores results in PostgreSQL

    Args:
        file_path: Azure Data Lake path to the document
        external_id: External document identifier
        brain_id: Brain/workspace identifier
        doc_id: Optional custom document ID (generated if not provided)
        local_file_path: Optional local file path to reuse instead of downloading

    Returns:
        Dict with parsing results:
        - doc_id: Document identifier
        - external_id: External document identifier
        - brain_id: Brain/workspace identifier
        - total_pages: Number of pages processed
        - total_blocks: Number of content blocks extracted
        - total_sections: Number of sections extracted
        - processing_time_ms: Processing time in milliseconds
        - status: "completed"
    """
    start_time = time.time()
    temp_folder = None
    resolved_local_file_path = local_file_path

    # Generate doc_id if not provided
    if not doc_id:
        doc_id = f"logical_{external_id}_{uuid.uuid4().hex[:8]}"

    logger.info(f"Starting logical indexing for {external_id} (brain: {brain_id})")

    try:
        # Create temp folder for processing (must be within SHARED_VOLUME_PREFIX for validation)
        temp_folder = os.path.join(settings.SHARED_VOLUME_PREFIX, f"logical_indexing_{uuid.uuid4().hex}")
        os.makedirs(temp_folder, exist_ok=True)

        # Step 1: Download document from Azure Data Lake when a local file is not already available
        if resolved_local_file_path is None:
            logger.info(f"Downloading document from Azure Data Lake: {file_path}")
            resolved_local_file_path = download_from_azure_datalake(file_path, temp_folder)
        else:
            logger.info(
                "Reusing local file for logical indexing: %s (source blob: %s)",
                resolved_local_file_path,
                file_path,
            )

        # Step 2: Convert non-PDF to PDF if needed
        file_ext = os.path.splitext(resolved_local_file_path)[1].lower()
        if file_ext != ".pdf":
            logger.info(
                "Logical indexing requires PDF input; converting local %s via source blob %s",
                resolved_local_file_path,
                file_path,
            )
            resolved_local_file_path = convert_file_to_pdf_and_upload(file_path, temp_folder)
        else:
            logger.info("Logical indexing will parse PDF directly: %s", resolved_local_file_path)

        # Step 3: Initialize pipeline with gRPC address
        grpc_address = settings.INTERNAL_LAYOUT_GRPC_ADDRESS
        logger.info(f"Initializing layout pipeline with gRPC: {grpc_address}")

        pipeline = LayoutPyMuPDFPipeline(
            device=settings.LOGICAL_INDEXING_DEVICE,
            layout_api_url=grpc_address
        )

        # Step 4: Parse document structure
        logger.info(f"Parsing document structure: {resolved_local_file_path}")
        pages_res = pipeline.process_pdf(resolved_local_file_path, dpi=144)

        # Step 5: Compile document structure
        logger.info(f"Compiling document structure for {doc_id}")
        compiled_doc = compile_document(pages_res, doc_id)

        # Generate overview
        overview = high_level_overview(compiled_doc)

        # Step 5b: Process images (crop, filter, compress, upload, describe)
        processed_images: List[Dict[str, Any]] = []
        if compiled_doc.images:
            logger.info(f"Processing {len(compiled_doc.images)} images for {doc_id}")
            datalake_directory = "/".join(file_path.split("/")[:-1])
            language = "en"
            processed_images = _process_images_for_document(
                compiled_doc=compiled_doc,
                pdf_path=resolved_local_file_path,
                temp_folder=temp_folder,
                datalake_directory=datalake_directory,
                language=language,
            )
            logger.info(f"Processed {len(processed_images)} images for {doc_id}")

        # Calculate processing time
        processing_time_ms = (time.time() - start_time) * 1000

        # Step 6: Store results in PostgreSQL
        logger.info(f"Storing results in PostgreSQL for {doc_id}")
        store_result = store_logical_indexing_result(
            doc_id=doc_id,
            external_id=external_id,
            brain_id=brain_id,
            compiled_doc=compiled_doc,
            overview=overview,
            processing_time_ms=processing_time_ms,
            processed_images=processed_images,
            source=source,
        )

        # Prepare result
        result = {
            "doc_id": doc_id,
            "external_id": external_id,
            "brain_id": brain_id,
            "total_pages": compiled_doc.total_pages,
            "total_blocks": len(compiled_doc.blocks),
            "total_sections": store_result.get("total_sections", 0),
            "total_images": len(processed_images),
            "processing_time_ms": processing_time_ms,
            "status": "completed",
        }

        logger.info(f"Logical indexing completed for {external_id}: {result}")

        return result

    except Exception as e:
        processing_time_ms = (time.time() - start_time) * 1000
        error_context = (
            f"Logical indexing failed for external_id={external_id}, "
            f"brain_id={brain_id}, file_path={file_path}, "
            f"local_file_path={resolved_local_file_path}, "
            f"processing_time_ms={processing_time_ms:.2f}: {e}"
        )
        logger.error(error_context, exc_info=True)
        raise RuntimeError(error_context) from e

    finally:
        # Cleanup temp folder
        if temp_folder and os.path.exists(temp_folder):
            try:
                shutil.rmtree(temp_folder)
                logger.debug(f"Cleaned up temp folder: {temp_folder}")
            except Exception as e:
                logger.warning(f"Failed to cleanup temp folder: {e}")


def parse_document_logical_task(
    file_path: str,
    external_id: str,
    brain_id: str,
    doc_id: Optional[str] = None,
    source: Optional[str] = None,
) -> Dict[str, Any]:
    """Standalone entrypoint for logical document indexing."""
    return _parse_document_logical(
        file_path=file_path,
        external_id=external_id,
        brain_id=brain_id,
        doc_id=doc_id,
        source=source,
    )


def store_logical_indexing_result(
    doc_id: str,
    external_id: str,
    brain_id: str,
    compiled_doc: Any,
    overview: str,
    processing_time_ms: float,
    processed_images: Optional[List[Dict[str, Any]]] = None,
    source: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Store logical indexing results in PostgreSQL.

    Args:
        doc_id: Document identifier
        external_id: External document identifier
        brain_id: Brain/workspace identifier
        compiled_doc: Compiled Document object from doc_outline_v2
        overview: High-level document overview
        processing_time_ms: Processing time in milliseconds
        processed_images: Optional list of processed image dicts from _process_images_for_document

    Returns:
        Dict with storage results
    """
    try:
        with get_db_session_sync() as session:
            # Check if document already exists
            existing_doc = session.query(LogicalDocument).filter(
                LogicalDocument.doc_id == doc_id
            ).first()

            if existing_doc:
                session.query(LogicalBlock).filter(
                    LogicalBlock.document_id == existing_doc.id
                ).delete()
                session.query(LogicalSection).filter(
                    LogicalSection.document_id == existing_doc.id
                ).delete()
                session.query(LogicalImage).filter(
                    LogicalImage.document_id == existing_doc.id
                ).delete()

                # Update existing document
                existing_doc.external_id = external_id
                existing_doc.brain_id = brain_id
                existing_doc.source = source
                existing_doc.total_pages = compiled_doc.total_pages
                existing_doc.overview = sanitize_text(overview)
                existing_doc.toc = sanitize_text(compiled_doc.toc)
                existing_doc.processing_time_ms = processing_time_ms

                doc_record = existing_doc
            else:
                # Create new document record
                doc_record = LogicalDocument(
                    doc_id=doc_id,
                    external_id=external_id,
                    brain_id=brain_id,
                    source=source,
                    total_pages=compiled_doc.total_pages,
                    overview=sanitize_text(overview),
                    toc=sanitize_text(compiled_doc.toc),
                    processing_time_ms=processing_time_ms,
                )
                session.add(doc_record)
                session.flush()  # Get the ID

            # Store blocks
            blocks_stored = 0
            for block_id, block in compiled_doc.blocks.items():
                block_record = LogicalBlock(
                    document_id=doc_record.id,
                    block_id=block.id,
                    block_type=block.label,
                    content=block.text,
                    page_number=block.page,
                    bbox={"x1": block.bbox[0], "y1": block.bbox[1], "x2": block.bbox[2], "y2": block.bbox[3]} if block.bbox else None,
                    level=block.heading_level,
                    parent_id=None,  # Could be derived from section structure
                )
                session.add(block_record)
                blocks_stored += 1

            # Store sections
            sections_stored = 0

            def store_sections_recursive(sections: list, parent_section_id: str = None):
                nonlocal sections_stored
                for sec in sections:
                    section_record = LogicalSection(
                        document_id=doc_record.id,
                        section_id=sec.id,
                        title=sanitize_text(sec.title),
                        level=sec.level,
                        parent_section_id=parent_section_id,
                        start_block_id=sec.block_id,
                        end_block_id=sec.content_ids[-1] if sec.content_ids else None,
                        page_start=sec.page,
                        page_end=sec.page,
                    )
                    session.add(section_record)
                    sections_stored += 1

                    # Recursively store children
                    if sec.children:
                        store_sections_recursive(sec.children, sec.id)

            store_sections_recursive(compiled_doc.sections)

            logger.info(f"Stored {blocks_stored} blocks and {sections_stored} sections for {doc_id}")

            # Generate embeddings for blocks with content
            session.flush()  # Ensure blocks are persisted

            # Get all blocks for this document
            block_records = session.query(LogicalBlock).filter(
                LogicalBlock.document_id == doc_record.id,
                LogicalBlock.content.isnot(None),
                LogicalBlock.content != ""
            ).all()

            if block_records:
                logger.info(f"Generating embeddings for {len(block_records)} blocks")
                embeddings = get_embeddings("logical_indexing")

                # Generate embeddings in batch
                texts = [b.content for b in block_records]
                vectors = embeddings.embed_documents(texts)

                # Update blocks with embeddings
                for block_record, vector in zip(block_records, vectors):
                    block_record.embedding = _normalize_embedding(vector)

                session.flush()

                logger.info(f"Generated embeddings for {len(block_records)} blocks")

            # Store images
            images_stored = 0
            if processed_images:
                for img_data in processed_images:
                    image_record = LogicalImage(
                        document_id=doc_record.id,
                        image_id=img_data["image_id"],
                        section_id=img_data.get("section_id"),
                        label=img_data["label"],
                        description=sanitize_text(img_data.get("description")),
                        image_path=img_data.get("image_path"),
                        image_compressed_path=img_data.get("image_compressed_path"),
                        bbox=img_data.get("bbox"),
                        page_number=img_data.get("page_number"),
                        dimensions=img_data.get("dimensions"),
                    )
                    session.add(image_record)
                    images_stored += 1

                session.flush()

                logger.info(f"Stored {images_stored} images for {doc_id}")

                # Generate embeddings for image descriptions
                image_records = session.query(LogicalImage).filter(
                    LogicalImage.document_id == doc_record.id,
                    LogicalImage.description.isnot(None),
                    LogicalImage.description != "",
                ).all()

                if image_records:
                    logger.info(f"Generating embeddings for {len(image_records)} image descriptions")
                    embeddings = get_embeddings("logical_indexing")

                    img_texts = [img.description for img in image_records]
                    img_vectors = embeddings.embed_documents(img_texts)

                    for img_record, vector in zip(image_records, img_vectors):
                        img_record.embedding = _normalize_embedding(vector)

                    session.flush()

                    logger.info(f"Generated embeddings for {len(image_records)} image descriptions")

            return {
                "total_blocks": blocks_stored,
                "total_sections": sections_stored,
                "total_images": images_stored,
                "document_id": doc_record.id,
            }

    except Exception as e:
        logger.error(f"Failed to store logical indexing result: {e}", exc_info=True)
        raise


def get_logical_indexing_result(
    external_id: str,
    brain_id: str
) -> Optional[Dict[str, Any]]:
    """
    Retrieve logical indexing result from PostgreSQL.

    Args:
        external_id: External document identifier
        brain_id: Brain/workspace identifier

    Returns:
        Dict with document structure or None if not found
    """
    with get_db_session_sync() as session:
        # Find document
        doc = session.query(LogicalDocument).filter(
            LogicalDocument.external_id == external_id,
            LogicalDocument.brain_id == brain_id
        ).first()

        if not doc:
            return None

        # Get blocks
        blocks = session.query(LogicalBlock).filter(
            LogicalBlock.document_id == doc.id
        ).order_by(LogicalBlock.page_number, LogicalBlock.id).all()

        # Get sections
        sections = session.query(LogicalSection).filter(
            LogicalSection.document_id == doc.id
        ).order_by(LogicalSection.id).all()

        # Get images
        images = session.query(LogicalImage).filter(
            LogicalImage.document_id == doc.id
        ).order_by(LogicalImage.page_number, LogicalImage.id).all()

        return {
            "doc_id": doc.doc_id,
            "external_id": doc.external_id,
            "brain_id": doc.brain_id,
            "source": doc.source,
            "total_pages": doc.total_pages,
            "overview": doc.overview,
            "toc": doc.toc,
            "processing_time_ms": doc.processing_time_ms,
            "created_at": doc.created_at.isoformat() if doc.created_at else None,
            "blocks": [
                {
                    "block_id": b.block_id,
                    "block_type": b.block_type,
                    "content": b.content,
                    "page_number": b.page_number,
                    "bbox": b.bbox,
                    "level": b.level,
                }
                for b in blocks
            ],
            "sections": [
                {
                    "section_id": s.section_id,
                    "title": s.title,
                    "level": s.level,
                    "parent_section_id": s.parent_section_id,
                    "page_start": s.page_start,
                    "page_end": s.page_end,
                }
                for s in sections
            ],
            "images": [
                {
                    "image_id": img.image_id,
                    "section_id": img.section_id,
                    "label": img.label,
                    "description": img.description,
                    "image_path": img.image_path,
                    "image_compressed_path": img.image_compressed_path,
                    "bbox": img.bbox,
                    "page_number": img.page_number,
                    "dimensions": img.dimensions,
                }
                for img in images
            ],
        }


def delete_logical_indexing_result(
    external_id: str,
    brain_id: str
) -> bool:
    """
    Delete logical indexing result from PostgreSQL.

    Args:
        external_id: External document identifier
        brain_id: Brain/workspace identifier

    Returns:
        True if deleted, False if not found
    """
    with get_db_session_sync() as session:
        # Find document
        doc = session.query(LogicalDocument).filter(
            LogicalDocument.external_id == external_id,
            LogicalDocument.brain_id == brain_id
        ).first()

        if not doc:
            return False

        # Delete (cascade will handle blocks, sections, and images)
        session.delete(doc)
        logger.info(f"Deleted logical indexing result for {external_id}")

        return True
