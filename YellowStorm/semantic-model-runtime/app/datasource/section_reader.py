"""Complete structural reading of the logical index (Phase 4C, P4.14-P4.21).

Reads authorized structure through the read-only adapter: outline, requested
structural closure, direct blocks in stable reading order, and bounded
evidence. ``sectionPk``/``blockPk`` are database ids that die on reindex;
``sectionKey``/``blockKey`` are parser-local keys. Both are kept explicit and
never conflated (P4.14). A cycle is reported, never silently discarded (P4.16).
"""

from __future__ import annotations

from collections import deque
from typing import Any

MAX_OUTLINE_NODES = 5000
MAX_CLOSURE_SECTIONS = 500
MAX_BLOCKS = 2000
MAX_EVIDENCE_BLOCKS = 200
MAX_EVIDENCE_CHARS = 4000


class SectionReadError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _bounded_int(value: Any, name: str, *, maximum: int, minimum: int = 1) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise SectionReadError(f"invalid_{name}")
    return value


def _parent_pk(parent: Any, own_pk: int) -> int | None:
    """Normalize the two reported root conventions to a single ``None`` (P4.16).

    The deployment carries both a self-referencing level-0 root and NULL-parent
    sections. A non-numeric parent is an anomaly, not a silent root.
    """
    if parent is None:
        return None
    text = str(parent).strip()
    if not text:
        return None
    if not text.isdigit():
        raise SectionReadError("malformed_parent_reference")
    value = int(text)
    return None if value == own_pk else value


def analyze_outline(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Normalize an outline, resolve roots and report cycles (pure, P4.15-P4.16)."""
    sections: list[dict[str, Any]] = []
    by_pk: dict[int, dict[str, Any]] = {}
    for row in rows:
        pk = row["id"]
        if isinstance(pk, bool) or not isinstance(pk, int):
            raise SectionReadError("invalid_section_pk")
        parent_pk = _parent_pk(row.get("parent_section_id"), pk)
        section = {
            "sectionPk": pk,
            "sectionKey": row.get("section_id"),
            "title": row.get("title"),
            "level": row.get("level"),
            "parentSectionPk": parent_pk,
        }
        sections.append(section)
        by_pk[pk] = section

    roots = [s["sectionPk"] for s in sections if s["parentSectionPk"] is None]
    cycles: list[list[int]] = []
    seen_cycles: set[frozenset[int]] = set()
    for section in sections:
        path: list[int] = []
        current: int | None = section["sectionPk"]
        while current is not None and current in by_pk:
            if current in path:
                loop = path[path.index(current):]
                key = frozenset(loop)
                if key not in seen_cycles:
                    seen_cycles.add(key)
                    cycles.append(loop)
                break
            path.append(current)
            current = by_pk[current]["parentSectionPk"]
    return {"sections": sections, "roots": roots, "cycles": cycles}


def structural_closure(sections: list[dict[str, Any]], target_pks: list[int],
                       *, include_descendants: bool) -> dict[str, Any]:
    """Resolve the requested closure with a visited set (P4.15).

    Returns the ordered section pks to read plus any requested target that is
    absent from the outline, so a caller reports a gap instead of a false empty.
    """
    by_pk = {s["sectionPk"]: s for s in sections}
    children: dict[int, list[int]] = {}
    for section in sections:
        parent = section["parentSectionPk"]
        if parent is not None:
            children.setdefault(parent, []).append(section["sectionPk"])
    missing = [pk for pk in target_pks if pk not in by_pk]
    ordered: list[int] = []
    visited: set[int] = set()
    queue: deque[int] = deque(pk for pk in target_pks if pk in by_pk)
    while queue:
        pk = queue.popleft()
        if pk in visited:
            continue
        visited.add(pk)
        ordered.append(pk)
        if include_descendants:
            queue.extend(children.get(pk, []))
    return {"sectionPks": ordered, "missingTargets": missing}


async def get_outline(connection: Any, *, document_pk: Any,
                      max_nodes: int = MAX_OUTLINE_NODES) -> dict[str, Any]:
    """Bounded outline for one logical document (P4.14)."""
    if isinstance(document_pk, bool) or not isinstance(document_pk, int) or document_pk <= 0:
        raise SectionReadError("invalid_document_pk")
    _bounded_int(max_nodes, "max_nodes", maximum=MAX_OUTLINE_NODES)
    # +1 row reports truncation precisely instead of false-positiving when the
    # document holds exactly max_nodes sections.
    rows = await connection.fetch(
        "SELECT id, section_id, title, level, parent_section_id FROM logical_sections "
        "WHERE document_id = $1 ORDER BY level NULLS LAST, id LIMIT $2",
        document_pk, max_nodes + 1,
    )
    truncated = len(rows) > max_nodes
    analyzed = analyze_outline(list(rows[:max_nodes]))
    return {
        "documentPk": document_pk,
        "sections": analyzed["sections"],
        "roots": analyzed["roots"],
        "cycles": analyzed["cycles"],
        "truncated": truncated,
    }


async def read_sections(connection: Any, *, document_pk: Any, section_pks: list[int],
                        include_descendants: bool = False, max_blocks: int = MAX_BLOCKS,
                        offset: int = 0) -> dict[str, Any]:
    """Read direct blocks for the requested closure in stable reading order.

    Headings are returned separately because they may not exist as ordinary
    stored blocks (P4.17). Zero returned blocks is reported as ``directBlocks``
    zero, never as "nothing relevant exists" (P4.20).
    """
    if isinstance(document_pk, bool) or not isinstance(document_pk, int) or document_pk <= 0:
        raise SectionReadError("invalid_document_pk")
    if not isinstance(section_pks, list) or not section_pks:
        raise SectionReadError("invalid_section_selection")
    if len(section_pks) > MAX_CLOSURE_SECTIONS:
        raise SectionReadError("section_selection_too_large")
    if any(isinstance(pk, bool) or not isinstance(pk, int) or pk <= 0 for pk in section_pks):
        raise SectionReadError("invalid_section_selection")
    _bounded_int(max_blocks, "max_blocks", maximum=MAX_BLOCKS)
    if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
        raise SectionReadError("invalid_offset")

    outline = await get_outline(connection, document_pk=document_pk)
    closure = structural_closure(outline["sections"], list(dict.fromkeys(section_pks)),
                                 include_descendants=include_descendants)
    by_pk = {s["sectionPk"]: s for s in outline["sections"]}
    selected = [by_pk[pk] for pk in closure["sectionPks"]]
    keys = [s["sectionKey"] for s in selected if isinstance(s["sectionKey"], str) and s["sectionKey"]]
    if not keys:
        return {"documentPk": document_pk, "sections": [], "missingTargets": closure["missingTargets"],
                "coverage": {"directBlocksComplete": True, "requestedSections": len(section_pks)},
                "continuation": None}

    rows = await connection.fetch(
        "SELECT id, section_id, block_id, block_type, content, page_number FROM logical_blocks "
        "WHERE document_id = $1 AND section_id = ANY($2::text[]) "
        "ORDER BY page_number NULLS LAST, id LIMIT $3 OFFSET $4",
        document_pk, keys, max_blocks + 1, offset,
    )
    truncated = len(rows) > max_blocks
    rows = list(rows[:max_blocks])
    blocks_by_key: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        blocks_by_key.setdefault(str(row["section_id"]), []).append({
            "blockPk": row["id"], "blockKey": row.get("block_id"),
            "blockType": row.get("block_type"), "content": row.get("content"),
            "pageNumber": row.get("page_number"),
        })
    return {
        "documentPk": document_pk,
        "sections": [{"sectionPk": s["sectionPk"], "sectionKey": s["sectionKey"],
                      "title": s["title"], "blocks": blocks_by_key.get(str(s["sectionKey"]), [])}
                     for s in selected],
        "missingTargets": closure["missingTargets"],
        "coverage": {"directBlocksComplete": not truncated,
                     "requestedSections": len(section_pks),
                     "returnedSections": len(selected),
                     "outlineTruncated": outline["truncated"]},
        "continuation": str(offset + max_blocks) if truncated else None,
    }


def _origin_for(block_type: Any) -> str:
    """Map an observed block type to an evidence origin (P4.18)."""
    text = str(block_type or "").lower()
    if "ocr" in text:
        return "ocr"
    if "generated" in text:
        return "generated_visual_description"
    return "native_text"


async def read_evidence(connection: Any, *, document_pk: Any, block_pks: list[int],
                        max_chars: int = MAX_EVIDENCE_CHARS,
                        visual_content_pending: bool = False) -> dict[str, Any]:
    """Read bounded evidence packets for explicit block locators (P4.21).

    Only directly assigned blocks are returned; section titles travel on their
    own because headings may not exist as stored blocks. Zero packets is
    reported as zero, never as proof nothing relevant exists (P4.20). The
    ``blockPk`` is a database id that dies on reindex and is always paired with
    the parser-local ``blockKey`` and ``sectionKey`` (P4.14).
    """
    if isinstance(document_pk, bool) or not isinstance(document_pk, int) or document_pk <= 0:
        raise SectionReadError("invalid_document_pk")
    if not isinstance(block_pks, list) or not block_pks:
        raise SectionReadError("invalid_block_selection")
    if len(block_pks) > MAX_EVIDENCE_BLOCKS:
        raise SectionReadError("block_selection_too_large")
    if any(isinstance(pk, bool) or not isinstance(pk, int) or pk <= 0 for pk in block_pks):
        raise SectionReadError("invalid_block_selection")
    _bounded_int(max_chars, "max_chars", maximum=MAX_EVIDENCE_CHARS)
    wanted = list(dict.fromkeys(block_pks))
    rows = await connection.fetch(
        "SELECT b.id AS block_pk, b.block_id AS block_key, b.section_id AS section_key, "
        "s.id AS section_pk, b.block_type, b.content, b.page_number "
        "FROM logical_blocks b "
        "LEFT JOIN logical_sections s "
        "  ON s.document_id = b.document_id AND s.section_id = b.section_id "
        "WHERE b.document_id = $1 AND b.id = ANY($2::bigint[]) "
        "ORDER BY b.page_number NULLS LAST, b.id LIMIT $3",
        document_pk, wanted, len(wanted),
    )
    packets = []
    for row in rows:
        content = row.get("content")
        text = "" if content is None else str(content)
        packets.append({
            "locator": {"documentPk": document_pk, "sectionPk": row.get("section_pk"),
                        "sectionKey": row.get("section_key"), "blockPk": row["block_pk"],
                        "blockKey": row.get("block_key"), "pageNumber": row.get("page_number")},
            "origin": _origin_for(row.get("block_type")),
            "rawText": text[:max_chars],
            "truncated": len(text) > max_chars,
        })
    return {
        "documentPk": document_pk,
        "packets": packets,
        "coverage": {
            "directBlocksComplete": len(packets) == len(wanted),
            "requiredSubsectionsComplete": True,
            "unresolvedReferences": [],
            "visualContentPending": bool(visual_content_pending),
        },
    }
