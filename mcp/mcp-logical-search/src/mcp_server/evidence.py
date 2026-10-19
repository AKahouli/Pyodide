"""Compact, exact evidence excerpts and a shared response byte budget."""

import json
import re


def query_terms(query):
    return list(dict.fromkeys(re.findall(r"\w+", (query or "").lower())))[:64]


def excerpt(content, query="", max_chars=1000):
    """Return one contiguous source slice; offsets refer to original characters."""
    content = content or ""
    if len(content) <= max_chars:
        return {"content": content, "content_truncated": False}
    # Find the densest bounded passage rather than always taking the beginning.
    terms = set(query_terms(query))
    matches = [m.start() for m in re.finditer(r"\w+", content)
               if m.group().lower() in terms]
    start = 0
    if matches:
        left = 0
        best = (0, 0)
        for right, position in enumerate(matches):
            while position - matches[left] >= max_chars * 0.75:
                left += 1
            if right - left + 1 > best[0]:
                best = (right - left + 1, matches[left])
        start = min(max(0, best[1] - max_chars // 8), len(content) - max_chars)
    return {"content": content[start:start + max_chars], "content_truncated": True,
            "content_length": len(content), "content_offset": start}


def serialized_bytes(value):
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def remove_navigation_entry(section, key):
    """Remove one navigation item and return the exact JSON byte-size change."""
    length = len(section[key])
    item = section[key].pop(0 if key == "ancestors" else -1)
    flag = key + "_truncated"
    flag_delta = (serialized_bytes({flag: True}) - serialized_bytes({flag: section[flag]})
                  if flag in section else serialized_bytes({flag: True}) - 1)
    section[flag] = True
    return -serialized_bytes(item) - int(length > 1) + flag_delta


def group_evidence(sections, max_bytes):
    """Group document metadata, retaining relevance order and explicit omissions.

    The budget includes the entire JSON response, not just content strings.
    Metadata is bounded by the caller's section limit. If that alone does not
    fit, omit trailing sections and expose an omitted-section count.
    """
    response = {"documents": [], "budget_exhausted": True}
    documents = {}
    seen_sections = set()
    entries = []
    for rank, original in enumerate(sections, 1):
        section_id = original["section_id"]
        if str(section_id) in seen_sections:
            continue
        seen_sections.add(str(section_id))
        key = (original.get("workspace_id"), original.get("document_id"))
        if key not in documents:
            document = {"document_id": original.get("document_id"), "sections": []}
            if original.get("workspace_id") is not None:
                document["workspace_id"] = original["workspace_id"]
            documents[key] = document
            response["documents"].append(document)
        section = {k: v for k, v in original.items()
                   if k not in ("workspace_id", "document_id", "file_name", "blocks")}
        section["rank"] = rank
        section["blocks"] = []
        for navigation_key in ("children", "ancestors", "descendants"):
            if navigation_key in section:
                section[navigation_key] = list(section[navigation_key])
        documents[key]["sections"].append(section)
        seen_blocks = set()
        blocks = []
        # Prefer the ranked representation if a neighbor aliases the same image.
        ordered = sorted(enumerate(original.get("blocks", [])),
                         key=lambda pair: (pair[1].get("selection") == "adjacent",
                                           pair[1].get("_selection_rank", float("inf")),
                                           -(pair[1].get("score") or 0)))
        for index, block in ordered:
            block = {k: v for k, v in block.items() if k != "_selection_rank"}
            identity = (("image", block["image_id"]) if block.get("image_id") is not None
                        else ("block", block.get("block_id")))
            if identity in seen_blocks:
                continue
            seen_blocks.add(identity)
            # Reserve image linkage/status metadata, added after text selection.
            image_reserve = (256 if block.get("image_id") is not None
                             or str(block.get("block_type", "")).startswith("image/")
                             or block.get("block_type") in ("image", "figure", "chart") else 0)
            blocks.append((index, block, serialized_bytes(block) + image_reserve))
        entries.append((section, original, blocks, []))
        if blocks:
            section["has_more_blocks"] = True

    # Reserve one byte per true->false flag and one for budget_exhausted.
    reserve = len(entries) + 1
    size = serialized_bytes(response)
    trimmed = False

    def trim_navigation():
        nonlocal size, trimmed
        for key in ("descendants", "children", "ancestors"):
            for section, _, _, _ in reversed(entries):
                if section.get(key):
                    size += remove_navigation_entry(section, key)
                    trimmed = True
                    return True
        return False

    while size + reserve > max_bytes and trim_navigation():
        pass
    while size + reserve > max_bytes and entries:
        section, _, _, _ = entries.pop()
        document = next(doc for doc in response["documents"]
                        if any(item is section for item in doc["sections"]))
        document["sections"].remove(section)
        response["sections_omitted"] = response.get("sections_omitted", 0) + 1
        if not document["sections"]:
            response["documents"].remove(document)
        trimmed = True
        reserve = len(entries) + 1
        size = serialized_bytes(response)

    # Allocate ranked hits round-robin before optional adjacent evidence.
    # Selection order must not change the final source order within a section.
    for adjacent in (False, True):
        queues = [[item for item in blocks
                   if (item[1].get("selection") == "adjacent") == adjacent]
                  for _, _, blocks, _ in entries]
        for position in range(max(map(len, queues), default=0)):
            for (section, _, _, selected), queue in zip(entries, queues):
                if position >= len(queue):
                    continue
                index, block, block_size = queue[position]
                extra = block_size + bool(selected)
                while size + extra + reserve > max_bytes and trim_navigation():
                    pass
                if size + extra + reserve <= max_bytes:
                    selected.append((index, block))
                    size += extra

    for section, original, blocks, selected in entries:
        section["blocks"] = [block for _, block in sorted(selected)]
        omitted = len(selected) < len(blocks)
        if blocks or "has_more_blocks" in original:
            section["has_more_blocks"] = bool(original.get("has_more_blocks") or omitted)
        trimmed |= omitted
    response["budget_exhausted"] = trimmed
    if serialized_bytes(response) > max_bytes:
        raise ValueError("Response budget too small for omission metadata")
    return response
