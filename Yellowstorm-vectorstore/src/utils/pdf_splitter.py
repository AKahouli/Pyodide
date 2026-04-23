from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Iterator, Tuple

import fitz


def _has_positive_area(rect: fitz.Rect) -> bool:
    """Return True when a rectangle has a renderable area."""
    return rect.width > 0 and rect.height > 0


def _is_renderable_pixmap(pixmap: fitz.Pixmap | None) -> bool:
    """Return True when a pixmap can be saved to disk."""
    return pixmap is not None and pixmap.width > 0 and pixmap.height > 0


def calculate_dpi(pdf_path: str, max_dimension: int = 3000) -> int:
    doc = fitz.open(pdf_path)
    try:
        page = doc.load_page(0)
        width_pt = page.rect.width
        height_pt = page.rect.height
        max_pt = max(width_pt, height_pt)
        dpi = int((max_dimension / max_pt) * 72)
        return max(dpi, 72)
    finally:
        doc.close()


def split_pdf_with_overlap(
    pdf_path: str,
    overlap_ratio: float = 0.1,
    dpi: int = 144
) -> Iterator[Tuple[int, str, fitz.Pixmap]]:
    doc = fitz.open(pdf_path)

    try:
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            page_rect = page.rect

            if page_rect.width <= 0 or page_rect.height <= 0:
                continue

            overlap_height = max(0, int(page_rect.height * overlap_ratio))
            overlap_height = min(
                overlap_height,
                max(0, int(page_rect.height) - 1),
            )

            bbox_top = fitz.Rect(
                page_rect.x0,
                page_rect.y0,
                page_rect.x1,
                page_rect.y1 - overlap_height,
            ) & page_rect

            if not bbox_top.is_empty and _has_positive_area(bbox_top):
                pix_top = _render_page_with_fallbacks(page, bbox_top, dpi)
                if _is_renderable_pixmap(pix_top):
                    yield (page_num, "top", pix_top)

            # Zero overlap means "full page only" for logical indexing.
            if overlap_height <= 0:
                continue

            if page_num > 0:
                bbox_bottom = fitz.Rect(
                    page_rect.x0,
                    page_rect.y1 - overlap_height,
                    page_rect.x1,
                    page_rect.y1,
                ) & page_rect

                if not bbox_bottom.is_empty and _has_positive_area(bbox_bottom):
                    pix_bottom = _render_page_with_fallbacks(page, bbox_bottom, dpi)
                    if _is_renderable_pixmap(pix_bottom):
                        yield (page_num - 1, "bottom", pix_bottom)
    finally:
        doc.close()


def _pdf_rect_to_pixmap_rect(rect: fitz.Rect, page_rect: fitz.Rect, scale: float) -> fitz.IRect:
    """
    Convert a PDF-space rect into pixel-space rect relative to a full-page pixmap.
    """
    x0 = int(round((rect.x0 - page_rect.x0) * scale))
    y0 = int(round((rect.y0 - page_rect.y0) * scale))
    x1 = int(round((rect.x1 - page_rect.x0) * scale))
    y1 = int(round((rect.y1 - page_rect.y0) * scale))
    return fitz.IRect(x0, y0, x1, y1)


def _crop_pixmap_safe(pix: fitz.Pixmap, irect: fitz.IRect) -> fitz.Pixmap | None:
    """
    Crop pixmap only if rect is valid and inside pixmap bounds.
    """
    bounds = fitz.IRect(0, 0, pix.width, pix.height)
    irect = irect & bounds

    if irect.is_empty or irect.width <= 0 or irect.height <= 0:
        return None

    try:
        return fitz.Pixmap(pix, irect)
    except Exception:
        return None


def _render_page_with_fallbacks(page: fitz.Page, bbox: fitz.Rect, dpi: int) -> fitz.Pixmap | None:
    """
    Render a PDF page region with safe fallbacks.
    """
    page_rect = page.rect
    bbox = bbox & page_rect

    if bbox.is_empty or bbox.width <= 0 or bbox.height <= 0:
        return None

    # Attempt 1: direct clipped render
    try:
        matrix = fitz.Matrix(dpi / 72, dpi / 72)
        pix = page.get_pixmap(matrix=matrix, clip=bbox, alpha=False)
        if pix.width > 0 and pix.height > 0:
            return pix
    except Exception:
        pass

    # Attempt 2: full render then crop using PIXEL coordinates
    try:
        scale = dpi / 72
        matrix = fitz.Matrix(scale, scale)
        pix_full = page.get_pixmap(matrix=matrix, alpha=False)
        crop_rect = _pdf_rect_to_pixmap_rect(bbox, page_rect, scale)
        pix = _crop_pixmap_safe(pix_full, crop_rect)
        if pix and pix.width > 0 and pix.height > 0:
            return pix
    except Exception:
        pass

    # Attempt 3: lower DPI full render then crop
    for test_dpi in (72, 96, 120):
        try:
            scale = test_dpi / 72
            matrix = fitz.Matrix(scale, scale)
            pix_full = page.get_pixmap(matrix=matrix, colorspace=fitz.csRGB, alpha=False)
            crop_rect = _pdf_rect_to_pixmap_rect(bbox, page_rect, scale)
            pix = _crop_pixmap_safe(pix_full, crop_rect)
            if pix and pix.width > 0 and pix.height > 0:
                return pix
        except Exception:
            continue

    # Attempt 4: minimal render then crop
    try:
        scale = 1.0
        pix_full = page.get_pixmap(alpha=False)
        crop_rect = _pdf_rect_to_pixmap_rect(bbox, page_rect, scale)
        pix = _crop_pixmap_safe(pix_full, crop_rect)
        if pix and pix.width > 0 and pix.height > 0:
            return pix
    except Exception:
        pass

    return None


def split_pdf_with_overlap_to_files(
    pdf_path: str,
    output_dir: str | Path = None,
    overlap_ratio: float = 0.1,
    dpi: int = 144
) -> Iterator[Tuple[int, str, str]]:
    if output_dir is None:
        tmpdir_obj = tempfile.TemporaryDirectory()
        output_dir = tmpdir_obj.name
        cleanup_tmpdir = True
    else:
        tmpdir_obj = None
        cleanup_tmpdir = False
        output_dir = str(output_dir)
        Path(output_dir).mkdir(parents=True, exist_ok=True)

    try:
        for page_num, region_type, pixmap in split_pdf_with_overlap(
            pdf_path, overlap_ratio, dpi
        ):
            if not _is_renderable_pixmap(pixmap):
                continue
            file_path = Path(output_dir) / f"page_{page_num}_{region_type}.png"
            try:
                pixmap.save(str(file_path))
            except Exception:
                continue

            yield (page_num, region_type, str(file_path))
    finally:
        if cleanup_tmpdir and tmpdir_obj:
            tmpdir_obj.cleanup()


def get_page_count(pdf_path: str) -> int:
    doc = fitz.open(pdf_path)
    try:
        return len(doc)
    finally:
        doc.close()
