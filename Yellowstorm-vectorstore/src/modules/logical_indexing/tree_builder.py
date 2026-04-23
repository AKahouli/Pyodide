"""
Hierarchical Document Tree Builder.

This module transforms PP-StructureV3 structure.json output into a hierarchical
tree structure for direct document navigation and reasoning-based retrieval.

The tree builder:
1. Parses blocks from structure.json into TreeNode objects
2. Builds hierarchical structure from sections
3. Computes ordered content IDs and indices
4. Provides O(1) flat index lookup
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel


# ============================================================================
# Data Models
# ============================================================================

class TreeNode(BaseModel):
    """A node in the hierarchical document tree.

    Each node represents a content block with its position in the document
    hierarchy, supporting both tree navigation and flat indexed access.
    """
    id: str
    """Block ID: "p{page}_b{block_id}\""""

    text: str | None = None
    """Extracted text content"""

    label: str
    """Raw PP-StructureV3 label: "text", "doc_title", "paragraph_title", etc."""

    node_type: str
    """Classification: "heading" | "content" | "meta" | "skip" """

    heading_level: int | None = None
    """For headings: 1=doc_title, 2=abstract, 3=paragraph_title"""

    page: int
    """0-based page index"""

    bbox: list[int] = []
    """Bounding box [x1, y1, x2, y2] in pixels"""

    section_path: list[str] = []
    """Hierarchical path: ["doc_title", "Sommaire"]"""

    image_path: str | None = None
    """For image/figure blocks: relative path to saved image"""

    children: list[TreeNode] = []
    """Nested child blocks (recursive)"""

    start_index: int | None = None
    """Index in flat content list (optional, for heading nodes)"""

    end_index: int | None = None
    """Index in flat content list (optional, for heading nodes)"""


class DocumentTree(BaseModel):
    """Root container for the hierarchical document tree.

    Provides both hierarchical (via root) and flat (via flat_index) access
    to document content.
    """
    doc_id: str
    """Document identifier"""

    total_pages: int
    """Total number of pages in the document"""

    root: TreeNode | None = None
    """Root node of the hierarchy (may contain multiple top-level sections)"""

    flat_index: dict[str, TreeNode] = {}
    """id -> TreeNode mapping for O(1) lookup"""

    ordered_content_ids: list[str] = []
    """All content blocks in document order"""


# ============================================================================
# Core Functions
# ============================================================================

def build_document_tree(structure_json: dict) -> DocumentTree:
    """Build hierarchical document tree from structure.json.

    Args:
        structure_json: Loaded structure.json dict with blocks and sections

    Returns:
        DocumentTree with hierarchical structure and flat index

    Example:
        >>> with open("structure.json") as f:
        ...     structure = json.load(f)
        >>> doc_tree = build_document_tree(structure)
        >>> # Navigate hierarchy
        >>> for child in doc_tree.root.children:
        ...     print(child.text)
        >>> # Look up by ID
        >>> node = doc_tree.flat_index["p0_b5"]
    """
    doc_id = structure_json.get("doc_id", "unknown")
    total_pages = structure_json.get("total_pages", 0)

    # Parse blocks dict into TreeNode objects
    blocks_data = structure_json.get("blocks", {})
    flat_index: dict[str, TreeNode] = {}

    for block_id, block_data in blocks_data.items():
        node = TreeNode(
            id=block_data.get("id", block_id),
            text=block_data.get("text"),
            label=block_data.get("label", ""),
            node_type=block_data.get("node_type", "content"),
            heading_level=block_data.get("heading_level"),
            page=block_data.get("page", 0),
            bbox=block_data.get("bbox", []),
            section_path=block_data.get("section_path", []),
            image_path=block_data.get("image_path"),
            children=[],
        )
        flat_index[block_id] = node

    # Build hierarchical structure from sections
    sections = structure_json.get("sections", [])
    top_level_nodes = _build_hierarchy(sections, flat_index)

    # Create virtual root if multiple top-level sections
    root: TreeNode | None = None
    if top_level_nodes:
        if len(top_level_nodes) == 1:
            # Single top-level node - use it as root
            root = top_level_nodes[0]
        else:
            # Multiple top-level sections - create virtual root
            root = TreeNode(
                id="root",
                text=None,
                label="root",
                node_type="root",
                heading_level=0,
                page=0,
                bbox=[],
                section_path=[],
                children=top_level_nodes,
            )

    # Compute ordered_content_ids by sorting blocks by (page, block_order)
    ordered_content_ids = _compute_ordered_ids(flat_index)

    # Compute start_index/end_index for each node
    if ordered_content_ids:
        _compute_indices(flat_index, ordered_content_ids)

    return DocumentTree(
        doc_id=doc_id,
        total_pages=total_pages,
        root=root,
        flat_index=flat_index,
        ordered_content_ids=ordered_content_ids,
    )


def _build_hierarchy(sections: list[dict], flat_index: dict[str, TreeNode]) -> list[TreeNode]:
    """Build hierarchical tree structure from sections.

    Args:
        sections: List of Section dicts with block_id, content_ids, children
        flat_index: Mapping of block IDs to TreeNode objects

    Returns:
        List of top-level TreeNode objects forming the hierarchy
    """
    if not sections:
        return []

    # Create mapping from block_id to section for lookups
    section_by_block_id: dict[str, dict] = {}
    for sec in sections:
        section_by_block_id[sec["block_id"]] = sec

    # Process each section and build tree
    def process_section(section_dict: dict) -> TreeNode:
        """Recursively process a section and its children."""
        block_id = section_dict["block_id"]
        heading_node = flat_index.get(block_id)

        # Create heading node if it doesn't exist
        if heading_node is None:
            heading_node = TreeNode(
                id=block_id,
                text=section_dict.get("title", ""),
                label=section_dict.get("title", "section"),
                node_type="heading",
                heading_level=section_dict.get("level", 3),
                page=section_dict.get("page", 0),
                bbox=[],
                section_path=[],
            )
            flat_index[block_id] = heading_node

        # Add content blocks as children
        content_ids = section_dict.get("content_ids", [])
        for content_id in content_ids:
            content_node = flat_index.get(content_id)
            if content_node and content_node.id != heading_node.id:
                heading_node.children.append(content_node)

        # Recursively process children
        for child_section in section_dict.get("children", []):
            child_node = process_section(child_section)
            if child_node.id != heading_node.id:
                heading_node.children.append(child_node)

        return heading_node

    # Process all sections to get top-level nodes
    # A section is top-level if its heading is not a child of another section
    all_block_ids = {sec["block_id"] for sec in sections}
    child_block_ids: set[str] = set()

    for sec in sections:
        for child in sec.get("children", []):
            child_block_ids.add(child["block_id"])

    top_level_block_ids = all_block_ids - child_block_ids
    top_level_nodes = []

    for block_id in top_level_block_ids:
        sec = section_by_block_id.get(block_id)
        if sec:
            top_level_nodes.append(process_section(sec))

    return top_level_nodes


def _compute_ordered_ids(flat_index: dict[str, TreeNode]) -> list[str]:
    """Compute ordered content IDs by page and block order.

    Args:
        flat_index: Mapping of block IDs to TreeNode objects

    Returns:
        List of block IDs in document order
    """
    # Sort by page, then by id (which has block_order embedded)
    # ID format: p{page}_b{block_id}
    def sort_key(node: TreeNode) -> tuple[int, int]:
        page = node.page
        # Extract block_id from ID
        # ID format: p{page}_b{block_id}
        try:
            parts = node.id.split("_b")
            block_id = int(parts[1]) if len(parts) > 1 else 0
        except (ValueError, IndexError):
            block_id = 0
        return (page, block_id)

    sorted_nodes = sorted(
        flat_index.values(),
        key=sort_key,
    )

    return [node.id for node in sorted_nodes if node.node_type in ("content", "heading")]


def _compute_indices(flat_index: dict[str, TreeNode], ordered_ids: list[str]) -> None:
    """Compute start_index and end_index for each node.

    For heading nodes: find position of first/last content in children
    For content nodes: set both indices to their position

    Args:
        flat_index: Mapping of block IDs to TreeNode objects (modified in-place)
        ordered_ids: List of content IDs in document order
    """
    # Create id -> position mapping
    id_to_position = {node_id: i for i, node_id in enumerate(ordered_ids)}

    # For each node, compute indices
    for node in flat_index.values():
        if node.node_type == "heading" and node.children:
            # Find min and max position among children
            positions = []
            for child in node.children:
                if child.id in id_to_position:
                    positions.append(id_to_position[child.id])
                elif child.children:
                    # Recursively check grandchildren
                    for grandchild in _collect_all_descendants(child):
                        if grandchild.id in id_to_position:
                            positions.append(id_to_position[grandchild.id])

            if positions:
                node.start_index = min(positions)
                node.end_index = max(positions)
        elif node.id in id_to_position:
            # Content node - both indices are its position
            pos = id_to_position[node.id]
            node.start_index = pos
            node.end_index = pos


def _collect_all_descendants(node: TreeNode) -> list[TreeNode]:
    """Collect all descendant nodes recursively.

    Args:
        node: TreeNode to collect descendants from

    Returns:
        List of all descendant nodes
    """
    descendants: list[TreeNode] = []
    for child in node.children:
        descendants.append(child)
        descendants.extend(_collect_all_descendants(child))
    return descendants


# ============================================================================
# Convenience Functions
# ============================================================================

def build_tree_from_file(structure_path: Path | str) -> DocumentTree:
    """Build document tree from structure.json file.

    Args:
        structure_path: Path to structure.json file or directory containing it

    Returns:
        DocumentTree with hierarchical structure

    Raises:
        FileNotFoundError: If structure.json not found
        ValueError: If structure.json is invalid
    """
    path = Path(structure_path)

    if path.is_dir():
        structure_path = path / "structure.json"
    else:
        structure_path = path

    if not structure_path.exists():
        raise FileNotFoundError(f"structure.json not found at {structure_path}")

    with open(structure_path, "r", encoding="utf-8") as f:
        structure_json = json.load(f)

    return build_document_tree(structure_json)


def find_subtree(
    doc_tree: DocumentTree,
    section_name: str,
    exact_match: bool = False,
) -> TreeNode | None:
    """Find a subtree node by section name.

    Args:
        doc_tree: DocumentTree to search
        section_name: Name or partial name of section to find
        exact_match: If True, require exact match; if False, allow partial match

    Returns:
        TreeNode if found, None otherwise
    """
    if not doc_tree.root:
        return None

    def search_node(node: TreeNode) -> TreeNode | None:
        """Recursively search for matching node."""
        # Check if current node matches
        node_title = node.text or node.label
        if exact_match:
            if node_title == section_name:
                return node
        else:
            if section_name.lower() in (node_title or "").lower():
                return node

        # Search children
        for child in node.children:
            result = search_node(child)
            if result:
                return result

        return None

    return search_node(doc_tree.root)


def get_node_text(node: TreeNode, include_children: bool = True) -> str:
    """Get text content from a node, optionally including children.

    Args:
        node: TreeNode to extract text from
        include_children: If True, include text from all descendants

    Returns:
        Concatenated text content
    """
    texts = []
    if node.text:
        texts.append(node.text)

    if include_children:
        for child in node.children:
            texts.append(get_node_text(child, include_children=True))

    return "\n".join(filter(None, texts))
