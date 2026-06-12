"""
Layout + PyMuPDF Pipeline: Fast text extraction without OCR.

This pipeline:
1. Uses gRPC layout detection from internal service
2. Extracts text using PyMuPDF (no OCR needed for digital PDFs)
3. Skips tables/images (bbox only)

Performance: ~50-100 ms/page (10-20x faster than PPStructureV3)
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, List

import fitz

from src.modules.logical_indexing.internal_layout_client import InternalLayoutClient
from src.utils.pdf_splitter import split_pdf_with_overlap_to_files, get_page_count

# PPStructureV3 default DPI
DPI = 144
PIXELS_TO_POINTS = DPI / 72.0


@dataclass
class LayoutBlock:
    """A block detected by layout model.

    Attributes:
        page_num: 0-based page index
        label: Layout label (e.g., "doc_title", "text", "table")
        bbox: Bounding box [x1, y1, x2, y2] in pixels
        confidence: Detection confidence score
        text: Extracted text (via PyMuPDF)
    """
    page_num: int
    label: str
    bbox: List[int]
    confidence: float
    text: str | None = None


class LayoutPyMuPDFPipeline:
    """
    Fast pipeline using layout detection + PyMuPDF text extraction.

    Benefits:
    - No OCR models loaded (saves GPU memory)
    - ~10-20x faster than PPStructureV3
    - 100% accurate text for digital PDFs
    """

    # Labels that are headings
    HEADING_LABELS = {
        "doc_title": 1,
        "abstract": 2,
        "paragraph_title": 3,
        "table_of_contents": 3,
    }

    def __init__(self, device: str = "gpu", layout_api_url: str = None):
        """
        Initialize the pipeline.

        Args:
            device: "gpu" or "cpu" for inference (kept for compatibility)
            layout_api_url: URL for internal layout gRPC service
        """
        self.device = device
        self.layout_api_url = layout_api_url
        self.layout_client = None

        if layout_api_url:
            # Use internal layout API (bypasses PyMuPDF rendering issues)
            self.layout_client = InternalLayoutClient(layout_api_url)
            logging.getLogger(__name__).info(
                f"Initialized LayoutPyMuPDFPipeline with gRPC layout detection at: {layout_api_url}"
            )

        # Thread pool for parallel processing
        self._executor = ThreadPoolExecutor(max_workers=5)
        # Lock to serialize gRPC calls (PaddlePaddle isn't thread-safe for concurrent inference)
        self._grpc_lock = asyncio.Lock()

    def _extract_table_text(self, page: fitz.Page, rect: fitz.Rect) -> str:
        """
        Extract text from table region, preserving structure.

        Uses multiple fallback methods for robustness:
        1. PyMuPDF's native table detection
        2. Dict mode for better cell handling
        3. Plain text fallback

        Args:
            page: PyMuPDF page object
            rect: Rectangle to extract text from (in points)

        Returns:
            Extracted table text as string
        """
        try:
            # Method 1: Use PyMuPDF's table detection (available in PyMuPDF 1.23+)
            try:
                tables = page.find_tables(clip=rect)
                if tables and len(tables.tables) > 0:
                    # Extract table as structured text (list of lists)
                    table = tables.tables[0]
                    extracted = table.extract()
                    if extracted:
                        # Format as tab-separated rows
                        rows = []
                        for row in extracted:
                            if row:
                                row_text = "\t".join(str(cell) if cell else "" for cell in row)
                                rows.append(row_text)
                        return "\n".join(rows)
            except (AttributeError, TypeError):
                # find_tables not available in this PyMuPDF version
                pass

            # Method 2: Fallback to dict mode for better cell handling
            text_dict = page.get_text("dict", clip=rect)
            lines = []
            for block in text_dict.get("blocks", []):
                if "lines" in block:
                    for line in block["lines"]:
                        line_text = "".join(span["text"] for span in line.get("spans", []))
                        if line_text.strip():
                            lines.append(line_text)
            if lines:
                return "\n".join(lines)

            # Method 3: Original fallback
            return page.get_text("text", clip=rect).strip()

        except Exception:
            # Ultimate fallback
            return page.get_text("text", clip=rect).strip()

    def detect_blocks(
        self,
        image_path: str,
        page_num: int
    ) -> List[LayoutBlock]:
        """
        Run layout detection on an image.

        Args:
            image_path: Path to image file
            page_num: 0-based page index

        Returns:
            List of LayoutBlock objects
        """
        logger = logging.getLogger(__name__)

        try:
            if self.layout_client is not None:
                # Use internal layout API
                logger.debug(f"Using gRPC layout client for {image_path}")
                boxes = self.layout_client.detect_layout(image_path)
                logger.debug(f"Detected {len(boxes)} boxes via gRPC for page {page_num}")
                return [
                    LayoutBlock(
                        page_num=page_num,
                        label=box.name,
                        bbox=[int(box.x1), int(box.y1), int(box.x2), int(box.y2)],
                        confidence=box.confidence,
                        text=None  # Will be filled by PyMuPDF
                    )
                    for box in boxes
                ]
            else:
                raise Exception(
                    "No layout detection method available. "
                    "Please provide a layout_api_url for gRPC layout detection."
                )

        except Exception as e:
            logger.error(f"Error detecting blocks in {image_path} (page {page_num}): {e}", exc_info=True)
            return []

    def extract_text_from_pdf(
        self,
        blocks: List[LayoutBlock],
        pdf_path: str
    ) -> List[LayoutBlock]:
        """
        Extract text from PDF using PyMuPDF for all blocks.

        Args:
            blocks: List of LayoutBlock objects
            pdf_path: Path to PDF file

        Returns:
            Updated list of LayoutBlock objects with text filled in
        """
        doc = fitz.open(pdf_path)

        try:
            for block in blocks:
                try:
                    page = doc.load_page(block.page_num)

                    # Convert pixel bbox to point bbox
                    x1, y1, x2, y2 = block.bbox
                    rect = fitz.Rect(
                        x1 / PIXELS_TO_POINTS,
                        y1 / PIXELS_TO_POINTS,
                        x2 / PIXELS_TO_POINTS,
                        y2 / PIXELS_TO_POINTS,
                    )

                    # Use table-specific extraction for tables
                    if block.label == "table":
                        block.text = self._extract_table_text(page, rect)
                    else:
                        # Extract text directly from PDF
                        block.text = page.get_text("text", clip=rect).strip()

                except Exception:
                    block.text = ""

            return blocks

        finally:
            doc.close()

    async def process_pdf_async(
        self,
        pdf_path: str,
        dpi: int = 144,
        max_concurrency: int = 5
    ) -> List[dict]:
        """
        Process PDF with parallel page processing.

        Args:
            pdf_path: Path to PDF file
            dpi: DPI for PDF to image conversion
            max_concurrency: Maximum number of pages to process concurrently

        Returns:
            List of page results in PPStructureV3-compatible format

        Raises:
            RuntimeError: If PDF cannot be processed
        """
        all_blocks = []
        logger = logging.getLogger(__name__)

        # Convert PDF to images (no overlap for full page processing)
        with tempfile.TemporaryDirectory() as tmpdir:
            try:
                regions = list(split_pdf_with_overlap_to_files(
                    pdf_path,
                    output_dir=tmpdir,
                    overlap_ratio=0.0,  # No overlap - full pages
                    dpi=dpi
                ))
            except Exception as e:
                raise RuntimeError(f"Failed to convert PDF to images: {e}") from e

            # Filter to top regions only (full pages)
            page_regions = [(p, r, i) for p, r, i in regions if r == "top"]

            if not page_regions:
                return self._to_ppstructure_format(all_blocks, pdf_path)

            # Semaphore to limit concurrency
            semaphore = asyncio.Semaphore(max_concurrency)

            async def process_single_page(page_num: int, img_path: str) -> List[LayoutBlock]:
                """Process a single page with bounded concurrency."""
                async with semaphore:
                    # Acquire lock to serialize gRPC calls (PaddlePaddle isn't thread-safe)
                    async with self._grpc_lock:
                        # Run blocking detect_blocks in executor
                        loop = asyncio.get_event_loop()
                        try:
                            blocks = await loop.run_in_executor(
                                self._executor,
                                lambda: self.detect_blocks(img_path, page_num)
                            )
                            return blocks
                        except Exception as e:
                            logger.error(f"Failed to process page {page_num}: {e}")
                            return []

            # Process all pages in parallel
            tasks = [process_single_page(p, i) for p, _, i in page_regions]
            page_results = await asyncio.gather(*tasks, return_exceptions=True)

            # Collect all blocks from successful results
            for result in page_results:
                if isinstance(result, list):
                    all_blocks.extend(result)
                elif isinstance(result, Exception):
                    logger.error(f"Page processing failed: {result}")

            # Extract text in batch (single PDF open for efficiency)
            if all_blocks:
                all_blocks = self.extract_text_from_pdf(all_blocks, pdf_path)

        # Convert to PPStructureV3-compatible format
        return self._to_ppstructure_format(all_blocks, pdf_path)

    def process_pdf(
        self,
        pdf_path: str,
        dpi: int = 144
    ) -> List[dict]:
        """
        Process entire PDF: layout detection + PyMuPDF text extraction.

        This is a synchronous wrapper around process_pdf_async for
        backward compatibility.

        Args:
            pdf_path: Path to PDF file
            dpi: DPI for PDF to image conversion

        Returns:
            List of page results in PPStructureV3-compatible format

        Raises:
            RuntimeError: If PDF cannot be processed
        """
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # If we're already in an async context, create a new loop
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        return loop.run_until_complete(self.process_pdf_async(pdf_path, dpi))

    def _to_ppstructure_format(
        self,
        blocks: List[LayoutBlock],
        pdf_path: str
    ) -> List[dict]:
        """
        Convert blocks to PPStructureV3-compatible format.

        Args:
            blocks: List of LayoutBlock objects
            pdf_path: Path to PDF file

        Returns:
            List of page result dicts compatible with compile_document()
        """
        num_pages = get_page_count(pdf_path)

        # Group blocks by page
        pages: dict[int, List[dict]] = {}
        for block in blocks:
            if block.page_num not in pages:
                pages[block.page_num] = []

            pages[block.page_num].append({
                "block_label": block.label,
                "block_bbox": block.bbox,
                "block_id": len(pages[block.page_num]),
                "block_order": len(pages[block.page_num]),
                "block_content": block.text,
            })

        # Convert to PPStructureV3 format
        results = []
        for page_idx in range(num_pages):
            parsing_list = pages.get(page_idx, [])

            result = {
                "res": {
                    "page_index": page_idx,
                    "parsing_res_list": parsing_list,
                    "width": 0,  # Will be filled if needed
                    "height": 0,
                }
            }
            results.append(result)

        return results
