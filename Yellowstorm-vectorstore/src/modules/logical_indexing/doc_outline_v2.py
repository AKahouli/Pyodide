"""
PP-StructureV3 Document Parsing Module.

This module transforms PP-StructureV3 output into structured JSON optimized for RAG applications.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import BaseModel


_CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ufeff]")


def sanitize_text(text: str | None) -> str | None:
    if not text:
        return text
    cleaned = _CONTROL_CHAR_RE.sub("", text)
    return cleaned.encode("utf-8", errors="surrogatepass").decode("utf-8", errors="ignore")


# ============================================================================
# Data Models
# ============================================================================

class Block(BaseModel):
    """A single parsed region from a document page.

    Attributes:
        id: Unique identifier in format "p{page}_b{block_id}"
        page: 0-based page index
        label: Raw PP-StructureV3 label (e.g., "doc_title", "table", "text")
        node_type: Classification: "heading" | "content" | "meta" | "skip"
        heading_level: For headings: 1=doc_title, 2=abstract, 3=paragraph_title
        bbox: Bounding box [x1, y1, x2, y2] in pixels
        text: OCR'd text, table HTML, or LaTeX formula
        section_path: Hierarchical path from root to this block's section
        image_path: Relative path to saved image (for image/figure blocks)
    """
    id: str
    page: int
    label: str
    node_type: str  # "heading" | "content" | "meta" | "skip"
    heading_level: int | None = None
    bbox: list[int] = []
    text: str | None = None
    section_path: list[str] = field(default_factory=list)
    image_path: str | None = None  # Relative path to saved image


class Section(BaseModel):
    """A logical grouping node in the document tree.

    Sections form a hierarchical structure representing the document's outline.
    """
    id: str
    title: str
    level: int
    page: int
    block_id: str  # id of the heading Block
    content_ids: list[str] = field(default_factory=list)
    children: list[Section] = field(default_factory=list)


class Document(BaseModel):
    """The compiled document model.

    Contains all blocks, the section tree, caption links, and table of contents.
    """
    doc_id: str
    total_pages: int
    blocks: dict[str, Block]
    images: dict[str, Block] = field(default_factory=dict)
    sections: list[Section]
    caption_links: dict[str, str] = field(default_factory=dict)
    toc: str = ""


# ============================================================================
# Label Taxonomy Configuration
# ============================================================================

HEADING_LABELS = {
    "doc_title": 1,
    "abstract": 2,
    "paragraph_title": 3,
    "table_of_contents": 3,
}

CONTENT_LABELS = {
    "text", "table", "image", "figure", "chart", "formula",
    "algorithm", "seal", "content",
}

META_LABELS = {
    "figure_caption", "table_caption", "references", "reference_content", "footnote",
}

SKIP_LABELS = {
    "header", "footer", "header_image", "footer_image", "number",
}


# ============================================================================
# Core Parsing Functions
# ============================================================================

IMAGE_LABELS = {
    "image", "figure", "chart",
}

IGNORED_LABELS = SKIP_LABELS | {"seal"}


def _classify_label(label: str) -> tuple[str, int | None, bool]:
    """Classify a label into (node_type, heading_level, is_image)."""
    is_image = label in IMAGE_LABELS
    if is_image:
        return "image", None, True
    if label in HEADING_LABELS:
        return "heading", HEADING_LABELS[label], False
    if label in META_LABELS:
        return "meta", None, False
    return "content", None, False


def _build_block(item: dict, page_idx: int, node_type: str, heading_level: int | None, is_image: bool) -> Block:
    """Build a Block object from a parsing result item."""
    bbox = item.get("block_bbox", [])
    final_bbox = bbox if isinstance(bbox, list) and len(bbox) >= 4 else []
    content = sanitize_text(item.get("block_content", ""))
    return Block(
        id=f"p{page_idx}_b{item.get('block_id', 0)}",
        page=page_idx,
        label=item.get("block_label", ""),
        node_type=node_type,
        heading_level=heading_level,
        bbox=final_bbox,
        text=content if content else None,
        section_path=[],
    )


def extract_blocks_from_page(page_entry: dict) -> tuple[list[Block], list[Block]]:
    """Extract Block objects from PPStructureV3 result.json['parsing_res_list'].

    Returns a tuple of (text_blocks, image_blocks) for this page.
    text_blocks: regular content/heading/meta blocks.
    image_blocks: image/figure/chart blocks with bbox preserved.
    """
    blocks: list[Block] = []
    image_blocks: list[Block] = []

    if "res" not in page_entry:
        return [], []

    page_data = page_entry["res"]
    page_idx = page_data.get("page_index", 0)
    parsing_list = page_data.get("parsing_res_list", [])

    for item in parsing_list:
        label = item.get("block_label", "")
        if label in IGNORED_LABELS:
            continue

        node_type, heading_level, is_image = _classify_label(label)
        block = _build_block(item, page_idx, node_type, heading_level, is_image)
        (image_blocks if is_image else blocks).append(block)

    return blocks, image_blocks


def build_section_tree(all_blocks: list[Block]) -> list[Section]:
    """Build hierarchical section structure using level-stack algorithm.

    Args:
        all_blocks: List of all blocks from the document

    Returns:
        List of top-level Section objects forming the document tree
    """
    # Filter only heading blocks, sorted by page and block order
    headings = [b for b in all_blocks if b.node_type == "heading"]
    headings.sort(key=lambda b: (b.page, b.id))

    if not headings:
        return []

    sections: list[Section] = []
    section_counter = 0
    stack: list[tuple[Section, int]] = []  # (section, depth) pairs

    for heading in headings:
        level = heading.heading_level or 3

        # Pop sections that are higher or equal level (close them)
        while stack and stack[-1][1] >= level:
            stack.pop()

        # Create new section
        section_counter += 1
        new_section = Section(
            id=f"sec_{section_counter}",
            title=heading.text or heading.label,
            level=level,
            page=heading.page,
            block_id=heading.id,
            content_ids=[],
            children=[],
        )

        if stack:
            # Add as child of the current top of stack
            parent_section = stack[-1][0]
            parent_section.children.append(new_section)
        else:
            # Top-level section
            sections.append(new_section)

        stack.append((new_section, level))

    # Assign content blocks to sections
    # Build section lookup by block_id
    section_by_block_id: dict[str, Section] = {}
    for sec in sections:
        section_by_block_id[sec.block_id] = sec
        # Also index children recursively
        stack = [sec]
        while stack:
            current = stack.pop()
            section_by_block_id[current.block_id] = current
            stack.extend(current.children)

    # Assign each content block to the most recent heading section
    current_section: Section | None = None
    current_level = 0

    for block in all_blocks:
        if block.node_type == "heading":
            # Update current section
            section = section_by_block_id.get(block.id)
            if section:
                current_section = section
                current_level = section.level
        elif block.node_type == "content":
            if current_section is not None:
                current_section.content_ids.append(block.id)
                # Set section_path for the block
                block.section_path = _get_section_path(section_by_block_id, current_section)

    return sections


def _get_section_path(section_by_block_id: dict[str, Section], section: Section) -> list[str]:
    """Get the hierarchical path from root to the given section."""
    path: list[str] = []

    # Build reverse lookup: child -> parent
    parent_of: dict[str, Section] = {}
    for sec in section_by_block_id.values():
        for child in sec.children:
            parent_of[child.block_id] = sec

    # Walk up from section to root
    current = section
    while current:
        path.insert(0, current.title)
        parent = parent_of.get(current.block_id)
        if parent:
            current = parent
        else:
            break

    return path


def _link_image_paths(all_blocks: list[Block], image_mappings: dict[str, str]) -> None:
    """Link saved image paths to blocks with image/figure labels.

    This function modifies the blocks in-place by setting their image_path field.

    Args:
        all_blocks: List of all blocks from the document
        image_mappings: Dict mapping original paths to saved relative paths
    """
    if not image_mappings:
        return

    # Create a mapping from bbox coordinates to image paths
    # PP-StructureV3 uses paths like "imgs/img_in_image_box_x1_y1_x2_y2.jpg"
    # or "imgs/img_in_table_box_x1_y1_x2_y2.jpg"
    for block in all_blocks:
        if block.label not in ("image", "figure"):
            continue

        # Try to match by bbox coordinates in the path
        if block.bbox and len(block.bbox) == 4:
            x1, y1, x2, y2 = block.bbox
            # Build bbox pattern that matches PP-StructureV3's format
            bbox_pattern = f"{x1}_{y1}_{x2}_{y2}"

            for original_path, saved_path in image_mappings.items():
                if bbox_pattern in original_path:
                    block.image_path = saved_path
                    break


def link_captions(all_blocks: list[Block]) -> dict[str, str]:
    """Link figure_caption/table_caption to nearest image/table using ±3 neighbor heuristic.

    Args:
        all_blocks: List of all blocks from the document

    Returns:
        Dictionary mapping caption block ID to content block ID
    """
    caption_links: dict[str, str] = {}

    # Group blocks by page
    blocks_by_page: dict[int, list[Block]] = {}
    for block in all_blocks:
        if block.page not in blocks_by_page:
            blocks_by_page[block.page] = []
        blocks_by_page[block.page].append(block)

    # Sort each page's blocks by y-coordinate (top to bottom)
    for page_blocks in blocks_by_page.values():
        page_blocks.sort(key=lambda b: b.bbox[1] if b.bbox and len(b.bbox) >= 2 else 0)

    # Process each page
    for page_num, page_blocks in blocks_by_page.items():
        for i, caption_block in enumerate(page_blocks):
            if caption_block.node_type != "meta":
                continue

            caption_label = caption_block.label
            if caption_label not in ("figure_caption", "table_caption"):
                continue

            # Search ±3 blocks for matching content
            search_range = range(max(0, i - 3), min(len(page_blocks), i + 4))

            for j in search_range:
                target_block = page_blocks[j]

                # Match figure_caption with image/figure
                if caption_label == "figure_caption":
                    if target_block.label in ("image", "figure"):
                        caption_links[caption_block.id] = target_block.id
                        break

                # Match table_caption with table
                elif caption_label == "table_caption":
                    if target_block.label == "table":
                        caption_links[caption_block.id] = target_block.id
                        break

    return caption_links


def _find_heading_for_image(img: Block, heading_blocks: list[Block]) -> Block | None:
    """Find the best matching heading block for an image based on page and y-position."""
    img_y = img.bbox[1] if img.bbox else 0
    best: Block | None = None
    for h in heading_blocks:
        if h.page > img.page:
            break
        if h.page == img.page:
            h_y = h.bbox[1] if h.bbox else 0
            if img_y >= h_y:
                best = h
        else:
            best = h
    return best


def _assign_images_to_sections(
    image_blocks: list[Block],
    all_blocks: list[Block],
) -> dict[str, str]:
    """Assign each image block to the section it falls within.

    Uses page number and y-position of the image bbox relative to headings
    to determine which section owns each image.

    Args:
        image_blocks: List of image/figure/chart Block objects.
        all_blocks: List of all non-image blocks (headings + content + meta).

    Returns:
        Dict mapping image block id -> section block id.
    """
    image_to_section: dict[str, str] = {}
    if not image_blocks:
        return image_to_section

    heading_blocks = [b for b in all_blocks if b.node_type == "heading"]
    heading_blocks.sort(key=lambda b: (b.page, b.bbox[1] if b.bbox else 0))

    for img in image_blocks:
        heading = _find_heading_for_image(img, heading_blocks)
        if heading is not None:
            image_to_section[img.id] = heading.id

    return image_to_section


def compile_document(
    pages_res: list,
    doc_id: str,
    image_mappings: dict[str, str] | None = None,
) -> Document:
    """Main orchestrator: extract blocks, build tree, link captions, compile output.

    Args:
        pages_res: Raw output from pipeline.predict(), list of page results
        doc_id: Document identifier
        image_mappings: Optional dict mapping original image paths to saved paths

    Returns:
        Complete Document object with blocks, images, sections, and metadata
    """
    all_blocks: list[Block] = []
    all_image_blocks: list[Block] = []
    for page_entry in pages_res:
        blocks, image_blocks = extract_blocks_from_page(page_entry)
        all_blocks.extend(blocks)
        all_image_blocks.extend(image_blocks)

    total_pages = len(pages_res)

    if image_mappings:
        _link_image_paths(all_blocks, image_mappings)

    sections = build_section_tree(all_blocks)

    _assign_images_to_sections(all_image_blocks, all_blocks)

    caption_links = link_captions(all_blocks)

    blocks_dict: dict[str, Block] = {b.id: b for b in all_blocks}
    images_dict: dict[str, Block] = {b.id: b for b in all_image_blocks}

    toc = render_toc(sections, blocks_dict)

    return Document(
        doc_id=doc_id,
        total_pages=total_pages,
        blocks=blocks_dict,
        images=images_dict,
        sections=sections,
        caption_links=caption_links,
        toc=toc,
    )


def compile_from_pages_res(
    pages_res: list,
    doc_id: str,
    save_json: bool = False,
) -> dict:
    """Wrapper with summary printing and optional JSON save.

    Args:
        pages_res: Raw output from pipeline.predict()
        doc_id: Document identifier
        save_json: If True, save the compiled document to a JSON file

    Returns:
        Dictionary representation of the compiled document
    """
    doc = compile_document(pages_res, doc_id)

    print(f"\n{'='*60}")
    print(f"Document: {doc.doc_id}")
    print(f"Pages: {doc.total_pages}")
    print(f"Total blocks: {len(doc.blocks)}")
    print(f"Total images: {len(doc.images)}")
    print(f"Sections: {_count_sections_recursive(doc.sections)}")

    type_counts: dict[str, int] = {}
    for block in doc.blocks.values():
        if block.node_type == "skip":
            continue
        type_counts[block.label] = type_counts.get(block.label, 0) + 1

    print(f"\nBlock type distribution:")
    for label, count in sorted(type_counts.items()):
        print(f"  {label}: {count}")

    print(f"Caption links: {len(doc.caption_links)}")
    print(f"{'='*60}\n")

    if save_json:
        output_path = Path(doc_id).stem + "_parsed.json" if Path(doc_id).suffix else f"{doc_id}_parsed.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(doc.model_dump(), f, indent=2, ensure_ascii=False)
        print(f"Saved to {output_path}")

    return doc.model_dump()


def _count_sections_recursive(sections: list[Section]) -> int:
    """Count total sections including nested children."""
    count = len(sections)
    for sec in sections:
        count += _count_sections_recursive(sec.children)
    return count


def high_level_overview(doc: Document | dict) -> str:
    """Generate ~100 token compact overview for LLM context injection.

    This provides a high-level document map that can be injected as a system prompt
    prefix to help the LLM understand document structure before targeted RAG retrieval.

    Args:
        doc: Document object or dict

    Returns:
        Compact overview string (~100-150 tokens)
    """
    if isinstance(doc, dict):
        doc = Document(**doc)

    lines: list[str] = []

    # Header
    lines.append(f"Document: {doc.doc_id}")
    lines.append(f"Pages: {doc.total_pages}  |  Sections: {_count_sections_recursive(doc.sections)}  |  Blocks: {len(doc.blocks)}  |  Images: {len(doc.images)}")
    lines.append("")

    # Structure outline
    lines.append("## Structure")

    def render_section_outline(sections: list[Section], indent: str = "") -> None:
        for sec in sections:
            lines.append(f"{indent}- {sec.title}  (p.{sec.page})")
            if sec.children:
                render_section_outline(sec.children, indent + "  ")

    render_section_outline(doc.sections)
    lines.append("")

    # Content inventory
    lines.append("## Content inventory")

    type_counts: dict[str, int] = {}
    for block in doc.blocks.values():
        if block.node_type in ("content", "heading"):
            type_counts[block.label] = type_counts.get(block.label, 0) + 1

    for label in sorted(type_counts.keys()):
        count = type_counts[label]
        lines.append(f"  {label.upper()}: {count}")

    return "\n".join(lines)


def render_toc(sections: list[Section], blocks_by_id: dict[str, Block]) -> str:
    """Generate human-readable full outline.

    Args:
        sections: List of top-level Section objects
        blocks_by_id: Dictionary mapping block IDs to Block objects

    Returns:
        Formatted table of contents string
    """
    lines: list[str] = []

    def render_recursive(sections: list[Section], indent: str = "") -> None:
        for sec in sections:
            lines.append(f"{indent}- {sec.title}  (p.{sec.page})  [{sec.id}]")
            if sec.children:
                render_recursive(sec.children, indent + "  ")

    render_recursive(sections)

    return "\n".join(lines)
