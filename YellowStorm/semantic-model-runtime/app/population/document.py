"""Deterministic, specification-bounded population from logical-index documents."""

from __future__ import annotations

import hashlib
import re
from typing import Any, Awaitable, Callable

from app.datasource.asset_delivery import AssetFetchError, fetch_workspace_asset_metadata
from app.datasource.attribute_extraction import AttributeExtractionError, extract_attributes
from app.datasource.discovery import resolve_asset_ref
from app.datasource.logical_index import (build_index_observation, detect_capabilities,
                                          resolve_document_candidates)
from app.datasource.logical_search import LogicalSearchError, combine_hits, search_exact, search_lexical
from app.datasource.section_reader import (MAX_CLOSURE_SECTIONS, SectionReadError,
                                           get_outline, read_complete_section_set)

from .document_rules import (PASSAGE_LOCATIONS, all_matches, clean, compile_pattern, fold,
                             folded_label_regex, heading_matches, heading_text, label_found,
                             next_line_values, normalize_ai_settings, same_line_values, shaped_input,
                             to_iso_date_or_period)
from .computed_fields import COMPUTED_VERSION, apply_computed, normalize_computed, recipe_sources
from .tabular import populate_concept_rows

# Bump when the way a document is read changes, so cached results are not reused.
DOCUMENT_EXTRACTION_VERSION = "document-v2"  # v2: summaries, choices and ISO dates for AI fields

EXTRACTOR_VERSION = "label-value-v4"
MAX_FIELD_VALUE_CHARS = 500
MAX_RAW_CHARS = 3000
RECORD_ROW_MIN_LABELS = 2


def _metadata_value(source: dict[str, Any], field: str) -> Any:
    return {"document_name": source.get("originalName"),
            "document_id": source.get("assetId"),
            "workspace_id": source.get("workspaceId")}.get(field)


def _label_value(text: Any, label: str) -> str | None:
    if not isinstance(text, str):
        return None
    match = re.search(
        rf"(?:^|[\r\n])\s*{re.escape(label)}\s*[:\-]\s*([^\r\n]{{1,{MAX_FIELD_VALUE_CHARS}}})",
        text, flags=re.IGNORECASE)
    return match.group(1).strip() if match else None


def _label_spans(text: Any, labels: list[str]) -> list[tuple[int, int, str]]:
    """Non-overlapping whole-word label occurrences, longest label first.

    Scanning longest-first stops a shorter mapped label from matching inside a
    longer one, so ``id`` is never counted within ``customer id``.
    """
    if not isinstance(text, str) or not labels:
        return []
    ordered = sorted(set(labels), key=len, reverse=True)
    pattern = re.compile(
        "|".join(rf"(?<![A-Za-z0-9_]){re.escape(label)}(?![A-Za-z0-9_])" for label in ordered),
        re.IGNORECASE)
    spans: list[tuple[int, int, str]] = []
    for match in pattern.finditer(text):
        if spans and match.start() < spans[-1][1]:
            continue
        matched = match.group(0)
        spans.append((match.start(), match.end(),
                      next(label for label in ordered if label.lower() == matched.lower())))
    return spans


def _record_row_value(text: str, label: str, labels: list[str],
                      spans: list[tuple[int, int, str]]) -> str | None:
    r"""Single token following a whole-word label inside a flattened record row.

    Extracted PDF tables arrive as one line of ``Label value`` pairs, so the
    separator is whitespace and later labels are not at line start. Exactly one
    bounded token is accepted, so a value cannot swallow the neighbouring pairs,
    and a label followed straight away by another mapped label is treated as a
    missing value rather than as a value named after the next label.
    """
    target = next(((start, end) for start, end, name in spans if name == label), None)
    if target is None:
        return None
    if any(start > target[1] and not text[target[1]:start].strip() for start, _, _ in spans):
        return None
    remainder = text[target[1]:]
    value = re.match(rf"(?:\s*[:\-]\s+|\s+)(\S{{1,{MAX_FIELD_VALUE_CHARS}}})", remainder)
    return value.group(1) if value else None


def _has_explicit_label_separator(text: str, labels: list[str]) -> bool:
    """A mapped label followed by ``:`` or ``-`` uses the explicit form."""
    return any(
        re.search(rf"(?<![A-Za-z0-9_]){re.escape(label)}(?![A-Za-z0-9_])\s*[:\-]", text,
                  flags=re.IGNORECASE)
        for label in labels)


def _is_record_row(text: Any, labels: list[str]) -> bool:
    """A record row is a punctuation-free line that opens with a mapped label.

    Blocks using explicit separators keep the line-anchored semantics, which
    preserves multi-word values; only flattened ``Label value`` rows that start
    at a label are read as records, so prose that merely mentions two labels is
    not mistaken for one.

    The two-label minimum is what separates a row from a sentence. A consequence
    is that a document mapping with a single extracted field cannot use this
    path; such a field needs an explicit ``Label:``/``Label -`` form, or AI
    extraction.
    """
    if not isinstance(text, str) or "." in text:
        return False
    if _has_explicit_label_separator(text, labels):
        return False
    spans = _label_spans(text, labels)
    if not spans or text[:spans[0][0]].strip():
        return False
    return len({name for _, _, name in spans}) >= RECORD_ROW_MIN_LABELS


def _record_row_blocks(sections: list[dict[str, Any]], labels: list[str],
                       ) -> list[tuple[dict[str, Any], dict[str, Any], list[tuple[int, int, str]]]]:
    rows = []
    for section in sections:
        for block in section["blocks"]:
            if block.get("origin") == "generated_visual_description":
                continue
            text = block.get("content")
            if _is_record_row(text, labels):
                rows.append((block, section, _label_spans(text, labels)))
    return rows


def _record_row_candidates(
        rows: list[tuple[dict[str, Any], dict[str, Any], list[tuple[int, int, str]]]],
        label: str, labels: list[str]) -> list[tuple[str, dict[str, Any], dict[str, Any]]]:
    candidates = []
    for block, section, spans in rows:
        value = _record_row_value(block.get("content"), label, labels, spans)
        if value is not None:
            candidates.append((value, block, section))
    return candidates


def _line_anchored_candidates(sections: list[dict[str, Any]], label: str,
                              ) -> list[tuple[str, dict[str, Any], dict[str, Any]]]:
    candidates = []
    for section in sections:
        for block in section["blocks"]:
            value = _label_value(block.get("content"), label)
            if value is not None and block.get("origin") != "generated_visual_description":
                candidates.append((value, block, section))
    return candidates


def _evidence(block: dict[str, Any], section: dict[str, Any], raw_text: str,
              asset_ref: dict[str, Any], mapping_version: str) -> dict[str, Any]:
    return {
        "assetRef": asset_ref,
        "sectionPk": section["sectionPk"], "sectionKey": section.get("sectionKey"),
        "blockPk": block["blockPk"], "blockKey": block.get("blockKey"),
        "pageNumber": block.get("pageNumber"), "origin": block.get("origin", "native_text"),
        "rawEvidenceHash": "sha256:" + hashlib.sha256(raw_text.encode()).hexdigest(),
        "extractorVersion": EXTRACTOR_VERSION, "mappingVersion": mapping_version,
    }


async def _whole_document(connection: Any, document_pk: Any) -> list[dict[str, Any]]:
    """Every section of the document (bounded by the outline limit), in reading order."""
    outline = await get_outline(connection, document_pk=document_pk)
    section_pks = [section["sectionPk"] for section in outline["sections"]][:MAX_CLOSURE_SECTIONS]
    if not section_pks:
        return []
    read = await read_complete_section_set(
        connection, document_pk=document_pk, section_pks=section_pks, include_descendants=True)
    return sorted(read["sections"], key=_section_position)


def _section_position(section: dict[str, Any]) -> tuple[int, int]:
    return min(((block.get("pageNumber") or 0, block.get("blockPk") or 0) for block in section["blocks"]),
               default=(10 ** 9, 10 ** 9))


def _usable_blocks(sections: list[dict[str, Any]], first_page_only: bool = False,
                   ) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    blocks = []
    for section in sections:
        for block in section["blocks"]:
            content = block.get("content")
            if not isinstance(content, str) or not content.strip():
                continue
            # Descriptions of pictures are written by the indexer, not by the document's author.
            if (block.get("origin") == "generated_visual_description"
                    or str(block.get("blockType") or "").startswith("image/image")):
                continue
            if first_page_only and block.get("pageNumber") not in (None, 1):
                continue
            blocks.append((block, section))
    return blocks


def _terms(labels: list[str]) -> set[str]:
    return {word for label in labels for word in re.findall(r"\w+", label.lower()) if len(word) >= 3}


def _select_ai_blocks(sections: list[dict[str, Any]], ai_mappings: list[dict[str, Any]],
                      settings: dict[str, int],
                      ) -> tuple[list[tuple[dict[str, Any], dict[str, Any]]], dict[str, Any]]:
    """The blocks the AI reads: the whole document when it is short, otherwise the blocks that
    mention each field (plus the opening of the document), always within the limits."""
    blocks = _usable_blocks(sections)
    total = sum(len(block["content"]) for block, _ in blocks)
    long_document = total > settings["longDocumentCharacters"]
    if long_document:
        chosen: set[int] = set(range(min(3, len(blocks))))
        for mapping in ai_mappings:
            terms = _terms(_mapping_labels(mapping))
            scored = []
            for index, (block, section) in enumerate(blocks):
                text = f"{section.get('title') or ''} {block['content']}".lower()
                score = sum(text.count(term) for term in terms)
                if score:
                    scored.append((-score, index))
            chosen.update(index for _, index in sorted(scored)[:settings["blocksPerField"]])
        blocks = [blocks[index] for index in sorted(chosen)]
    selected: list[tuple[dict[str, Any], dict[str, Any]]] = []
    used = 0
    for block, section in blocks[:settings["maxBlocks"]]:
        room = settings["maxCharacters"] - used
        if room < 200:
            break
        content = block["content"][:min(room, 20000)]
        selected.append(({**block, "content": content}, section))
        used += len(content)
    return selected, {"documentCharacters": total, "longDocument": long_document,
                      "blocksSent": len(selected), "charactersSent": used}


def _normalize_for_grounding(value: Any) -> str:
    return " ".join(str(value).split()).casefold()


def _value_in_block(value: Any, content: Any) -> bool:
    """True when the value appears in the cited block, ignoring case/spacing."""
    if value is None or not isinstance(content, str):
        return False
    if isinstance(value, (list, tuple, dict)):
        return False
    normalized = _normalize_for_grounding(value).strip('"\'')
    return bool(normalized) and normalized in _normalize_for_grounding(content)


def _mapping_labels(mapping: dict[str, Any]) -> list[str]:
    rules = mapping.get("rules") or {}
    return list(rules.get("labels") or []) or [mapping["sourceField"]]


def _strategy(mapping: dict[str, Any]) -> str:
    return mapping.get("extractionStrategy") or "deterministic"


async def _apply_ai_extraction(
    entry: dict[str, Any], asset_ref: dict[str, Any], sections: list[dict[str, Any]],
    ai_mappings: list[dict[str, Any]], model_id: str, ai_extraction: dict[str, Any] | None,
    values: dict[str, Any], evidence_by_field: dict[str, dict[str, Any]], settings: dict[str, int],
    quotes: dict[str, str] | None = None, records: list[dict[str, Any]] | None = None,
) -> tuple[str | None, dict[str, Any]]:
    """Resolve AI-mapped fields; return a failure code (None when it ran) and what was sent.

    With ``records`` (a list to fill), the agent is asked for every item in the document and each
    one is appended with its own grounded values and evidence.
    """
    selected, sent = _select_ai_blocks(sections, ai_mappings, settings)
    if not selected:
        return "no_evidence", sent
    payload = [{"sectionPk": section["sectionPk"], "blockPk": block["blockPk"], "content": block["content"]}
               for block, section in selected]
    by_reference = {f"section:{section['sectionPk']}/block:{block['blockPk']}": (block, section)
                    for block, section in selected}
    attributes = []
    for mapping in ai_mappings:
        labels = _mapping_labels(mapping)
        attributes.append(_ai_attribute(mapping, labels))
    try:
        result = await extract_attributes(
            model_id=model_id, concept_id=entry["conceptId"],
            concept_label=entry.get("conceptLabel") or entry["conceptId"],
            document_id=str(entry["source"].get("assetId") or ""),
            file_name=str(entry["source"].get("originalName") or ""),
            attributes=attributes, sections=payload, ai_extraction=ai_extraction,
            multiple=records is not None)
    except AttributeExtractionError as exc:
        return exc.code, sent
    extractor_version = str(result.get("extractorVersion") or "ai-attribute-v1")
    rules_by_key = {mapping["targetAttribute"]: mapping.get("rules") for mapping in ai_mappings}
    keys = set(rules_by_key)
    choices = {mapping["targetAttribute"]: allowed for mapping in ai_mappings
               if (allowed := [str(item) for item in mapping.get("allowedValues") or [] if str(item).strip()])}
    summaries = {mapping["targetAttribute"] for mapping in ai_mappings
                 if mapping.get("valueType") in (None, "text", "date") and mapping["targetAttribute"] not in choices}
    _ground_values(result.get("values") or [], keys, by_reference, rules_by_key, entry, asset_ref,
                   extractor_version, result.get("model"), values, evidence_by_field, quotes, choices)
    if records is not None:
        for item in result.get("records") or []:
            if not isinstance(item, dict):
                continue
            own: dict[str, Any] = {}
            own_evidence: dict[str, dict[str, Any]] = {}
            _ground_values(item.get("values") or [], keys, by_reference, rules_by_key, entry, asset_ref,
                           extractor_version, result.get("model"), own, own_evidence, None, choices, summaries)
            if own:
                records.append({"values": own, "evidence": own_evidence})
    # The agent chosen for a field is recorded with its evidence. Only the platform extraction agent
    # can read fields today, so a chosen agent is noted, not yet called.
    agents = {mapping["targetAttribute"]: mapping["agentId"] for mapping in ai_mappings
              if isinstance(mapping.get("agentId"), str) and mapping["agentId"].strip()}
    for found in [evidence_by_field, *(record["evidence"] for record in records or [])]:
        for key in agents.keys() & set(found):
            found[key]["requestedAgentId"] = agents[key]
    # Dates read by AI are stored as ISO, as precise as the text (a period keeps its start);
    # one that is not a date the runtime can read stays as written.
    dates = {mapping["targetAttribute"] for mapping in ai_mappings if mapping.get("valueType") == "date"}
    for found in [values, *(record["values"] for record in records or [])]:
        for key in dates & set(found):
            if isinstance(found[key], str):
                found[key] = to_iso_date_or_period(found[key]) or found[key]
    return None, sent


_AI_VALUE_TYPES = {"text": "string", "number": "number", "date": "date", "boolean": "boolean", "enum": "string"}


def _ai_attribute(mapping: dict[str, Any], labels: list[str]) -> dict[str, Any]:
    """How one field is described to the extraction agent: its meaning, other names and allowed values."""
    parts = []
    # The field's own definition wins over the attribute description the backend may have put there.
    definition = next((text.strip() for text in (mapping.get("semanticDefinition"), mapping.get("description"))
                       if isinstance(text, str) and text.strip()), None)
    if definition:
        parts.append(definition)
    allowed = [str(item) for item in mapping.get("allowedValues") or [] if str(item).strip()]
    if allowed:
        parts.append("One of: " + ", ".join(allowed) + ".")
    if len(labels) > 1:
        parts.append("Also written as: " + ", ".join(labels[1:]))
    attribute: dict[str, Any] = {"key": mapping["targetAttribute"], "label": labels[0]}
    if parts:
        attribute["description"] = " ".join(parts)[:2000]
    if mapping.get("valueType") in _AI_VALUE_TYPES:
        attribute["type"] = _AI_VALUE_TYPES[mapping["valueType"]]
    return attribute


def _choice(value: Any, allowed: list[str]) -> str | None:
    """The allowed value the agent picked, ignoring case and spacing."""
    if not isinstance(value, str):
        return None
    wanted = _normalize_for_grounding(value).strip('"\'')
    return next((item for item in allowed if _normalize_for_grounding(item) == wanted), None)


def _ground_values(
    items: list[Any], keys: set[str], by_reference: dict[str, tuple[dict[str, Any], dict[str, Any]]],
    rules_by_key: dict[str, Any], entry: dict[str, Any], asset_ref: dict[str, Any],
    extractor_version: str, model: Any, values: dict[str, Any],
    evidence_by_field: dict[str, dict[str, Any]], quotes: dict[str, str] | None,
    choices: dict[str, list[str]] | None = None, summaries: set[str] | None = None,
) -> None:
    """Keep each value the agent returned only when it occurs in a block the runtime sent.

    A field with allowed values keeps the allowed value the agent picked, from a block it really
    sent. A text or date field in ``summaries`` (one item of a document read for several) may put
    the cited block in its own words (a date written as ISO, say), but only when another value of the same item is quoted from
    that block: the item itself is then proven to be in the document.
    """
    choices = choices or {}
    rephrased: list[tuple[str, Any, tuple[dict[str, Any], dict[str, Any]]]] = []
    quoted_blocks: set[str] = set()
    for item in items:
        key = item.get("key") if isinstance(item, dict) else None
        if not key or key not in keys or key in values:
            continue
        grounded = [reference for reference in (item.get("evidenceReferences") or [])
                    if reference in by_reference]
        if not grounded:
            continue
        block, section = by_reference[grounded[0]]
        value = item.get("value")
        if key in choices:
            value = _choice(value, choices[key])
            if value is None:
                continue
        # A real reference is not proof of a real value: the value must occur in
        # the block it cites, otherwise the model invented it.
        elif not _value_in_block(value, block.get("content")):
            if summaries and key in summaries and isinstance(value, str) and value.strip():
                rephrased.append((key, value.strip(), (block, section)))
            continue
        else:
            quoted_blocks.add(grounded[0])
        _keep_value(key, value, block, section, rules_by_key, entry, asset_ref, extractor_version,
                    model, values, evidence_by_field, quotes)
    for key, value, (block, section) in rephrased:
        reference = f"section:{section['sectionPk']}/block:{block['blockPk']}"
        if key in values or reference not in quoted_blocks:
            continue
        _keep_value(key, value, block, section, rules_by_key, entry, asset_ref, extractor_version,
                    model, values, evidence_by_field, quotes)
        evidence_by_field[key]["rephrased"] = True


def _keep_value(
    key: str, value: Any, block: dict[str, Any], section: dict[str, Any], rules_by_key: dict[str, Any],
    entry: dict[str, Any], asset_ref: dict[str, Any], extractor_version: str, model: Any,
    values: dict[str, Any], evidence_by_field: dict[str, dict[str, Any]], quotes: dict[str, str] | None,
) -> None:
    rules = rules_by_key.get(key)
    if rules and rules.get("transform") not in (None, "none") and isinstance(value, str):
        value = clean(value, {**rules, "pattern": None}) or value
    values[key] = value
    if quotes is not None:
        quotes[key] = str(block.get("content") or "")[:600]
    evidence = _evidence(block, section, str(block.get("content") or ""), asset_ref,
                         entry["mappingVersion"])
    evidence["origin"] = "ai"
    evidence["extractorVersion"] = extractor_version
    if model:
        evidence["model"] = model
    evidence_by_field[key] = evidence


_PASSAGE_LEAD = re.compile(r"^[\s:\-\u2013\u2014=]+")


def _reading_order(whole: list[dict[str, Any]], first_page_only: bool = False,
                   ) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """Every readable block once, in reading order, with its section."""
    seen: set[Any] = set()
    ordered = []
    for block, section in _usable_blocks(whole, first_page_only):
        key = block.get("blockPk")
        if key is not None and key in seen:
            continue
        seen.add(key)
        ordered.append((block, section))
    return ordered


def _numbering(title: str) -> str:
    """The numbering of a heading (``1.2.`` of ``1.2. Données``), or "" when it has none."""
    text = title.strip()
    return text[:len(text) - len(heading_text(text))].strip()


def _same_section(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return left is right or (left.get("sectionPk") is not None and left.get("sectionPk") == right.get("sectionPk"))


def _in_section(section: dict[str, Any], heading: dict[str, Any]) -> bool:
    """The section is the heading's own, or one of its numbered subsections (``1.2.1.`` in ``1.2.``)."""
    if _same_section(section, heading):
        return True
    prefix = _numbering(str(heading.get("title") or "")).rstrip(".") + "."
    return prefix != "." and _numbering(str(section.get("title") or "")).startswith(prefix)


def _label_at(content: str, labels: list[str]) -> tuple[int, int] | None:
    """Where the first of the labels is in the text (case and accents aside), as (start, end)."""
    folded = fold(content)
    best: tuple[int, int] | None = None
    for label in labels:
        found = folded_label_regex(label).search(folded)
        if found and (best is None or found.start() < best[0]):
            best = (found.start(), found.end())
    if best is None:
        return None
    # Folding drops accents and doubled spaces: map the folded positions back to the text.
    start = next((index for index in range(len(content) + 1) if len(fold(content[:index] + "x")) - 1 >= best[0]), 0)
    end = next((index for index in range(start, len(content) + 1) if len(fold(content[:index])) >= best[1]),
               len(content))
    return start, end


def _is_heading_block(block: dict[str, Any], section: dict[str, Any]) -> bool:
    return bool(section["blocks"]) and section["blocks"][0] is block


def _passage(parts: list[tuple[str, dict[str, Any], dict[str, Any]]],
             ) -> tuple[str, dict[str, Any], dict[str, Any]] | None:
    """Pieces of text joined as one passage, attached to the block it starts in."""
    kept = [(text.strip(), block, section) for text, block, section in parts if text and text.strip()]
    if not kept:
        return None
    value = "\n\n".join(text for text, _, _ in kept)
    _, block, section = kept[0]
    pages = [item[1].get("pageNumber") for item in kept if item[1].get("pageNumber") is not None]
    return value, {**block, "content": value, "lastPageNumber": max(pages) if pages else None}, section


def _after(ordered: list[tuple[dict[str, Any], dict[str, Any]]], index: int, titled: bool,
           at: tuple[int, int] | None, boundary: list[str]) -> list[tuple[str, dict[str, Any], dict[str, Any]]]:
    """The text after the label: to the first boundary label, or else to the end of its section."""
    block, section = ordered[index]
    # A section title is not a block: under a heading, the section's first block is already content.
    first = block["content"] if titled else _PASSAGE_LEAD.sub("", block["content"][at[1]:])
    stop = _label_at(first, boundary) if boundary else None
    if stop is not None:
        return [(first[:stop[0]], block, section)]
    parts = [(first, block, section)]
    for later, later_section in ordered[index + 1:]:
        if boundary:
            if (_is_heading_block(later, later_section) and not _same_section(later_section, section)
                    and heading_matches(str(later_section.get("title") or ""), boundary)):
                break
            stop = _label_at(later["content"], boundary)
            if stop is not None:
                parts.append((later["content"][:stop[0]], later, later_section))
                break
        elif not _in_section(later_section, section):
            break
        parts.append((later["content"], later, later_section))
    return parts


def _before(ordered: list[tuple[dict[str, Any], dict[str, Any]]], index: int, titled: bool,
            at: tuple[int, int] | None, boundary: list[str]) -> list[tuple[str, dict[str, Any], dict[str, Any]]]:
    """The text before the label: from the first boundary label before it, or else from the start of
    its section (the section just before, when the label is a heading)."""
    block, section = ordered[index]
    if not titled and boundary:
        start = _label_at(block["content"][:at[0]], boundary)
        if start is not None:
            return [(_PASSAGE_LEAD.sub("", block["content"][start[1]:at[0]]), block, section)]
    parts = [] if titled else [(block["content"][:at[0]], block, section)]
    home = section
    if titled:
        earlier = [item for item in ordered[:index] if not _same_section(item[1], section)]
        if not earlier:
            return []
        home = earlier[-1][1]
    for earlier_block, earlier_section in reversed(ordered[:index]):
        if boundary:
            start = _label_at(earlier_block["content"], boundary)
            if start is not None:
                parts.insert(0, (_PASSAGE_LEAD.sub("", earlier_block["content"][start[1]:]), earlier_block, earlier_section))
                break
            if (_is_heading_block(earlier_block, earlier_section)
                    and heading_matches(str(earlier_section.get("title") or ""), boundary)):
                parts.insert(0, (earlier_block["content"], earlier_block, earlier_section))
                break
        elif not _same_section(earlier_section, home):
            break
        parts.insert(0, (earlier_block["content"], earlier_block, earlier_section))
    return parts


def _passage_candidates(rules: dict[str, Any], labels: list[str], whole: list[dict[str, Any]],
                        ) -> list[tuple[str, dict[str, Any], dict[str, Any]]]:
    """Whole passages: the text after or before a label (or under a heading), or whole pages."""
    location = rules["location"]
    ordered = _reading_order(whole, bool(rules.get("firstPageOnly")))
    if location == "pages":
        span = rules["pages"]
        found = _passage([(block["content"], block, section) for block, section in ordered
                          if span["from"] <= (block.get("pageNumber") or 0) <= span["to"]])
        return [found] if found else []
    boundary = rules.get("boundaryLabels") or []
    reader = _after if location == "after_label" else _before
    headings, mentions = [], []
    for index, (block, section) in enumerate(ordered):
        titled = _is_heading_block(block, section) and heading_matches(str(section.get("title") or ""), labels)
        at = None if titled else _label_at(block["content"], labels)
        if not titled and at is None:
            continue
        found = _passage(reader(ordered, index, titled, at, boundary))
        if found:
            (headings if titled else mentions).append(found)
    # A heading named like the label is the section meant; a table of contents only mentions it.
    return headings or mentions


def _rule_candidates(mapping: dict[str, Any], rules: dict[str, Any] | None, label_sections: list[dict[str, Any]],
                     whole: list[dict[str, Any]], all_labels: list[str],
                     ) -> tuple[list[tuple[str, dict[str, Any], dict[str, Any]]], list[str]]:
    """Values the rules find for one field, with where each came from, and the raw texts found
    before the pattern and clean-up (to tell "nothing there" from "not what was expected")."""
    location = rules["location"] if rules else "auto"
    labels = _mapping_labels(mapping)
    first_page_only = bool(rules and rules.get("firstPageOnly"))
    raw: list[tuple[str, dict[str, Any], dict[str, Any]]] = []
    if location == "auto":
        record_rows = _record_row_blocks(label_sections, all_labels)
        for label in labels:
            raw += _line_anchored_candidates(label_sections, label)
            raw += _record_row_candidates(record_rows, label, all_labels)
        if first_page_only:
            raw = [item for item in raw if item[1].get("pageNumber") in (None, 1)]
    elif location in ("same_line", "next_line", "table"):
        record_rows = _record_row_blocks(label_sections, all_labels) if location == "table" else []
        for block, section in _usable_blocks(label_sections, first_page_only):
            if location == "table" and "table" not in str(block.get("blockType") or ""):
                continue
            for label in labels:
                found = (same_line_values(block["content"], label) if location != "next_line"
                         else next_line_values(block["content"], label))
                raw += [(value, block, section) for value in found]
        for label in labels:
            raw += [item for item in _record_row_candidates(record_rows, label, all_labels)
                    if not first_page_only or item[1].get("pageNumber") in (None, 1)]
    elif location == "heading":
        for section in whole:
            title = str(section.get("title") or "").strip()
            if not title:
                continue
            block = section["blocks"][0] if section["blocks"] else {"blockPk": None, "pageNumber": None}
            if first_page_only and block.get("pageNumber") not in (None, 1):
                continue
            raw.append((title, {**block, "content": title}, section))
    elif location in PASSAGE_LOCATIONS:
        raw += _passage_candidates(rules, labels, whole)
    elif location == "anywhere":
        compiled = compile_pattern(rules["pattern"])
        for block, section in _usable_blocks(whole, first_page_only):
            raw += [(value, block, section) for value in all_matches(compiled, block["content"])]
    cleaned = []
    for value, block, section in raw:
        kept = clean(value, rules)
        if kept is not None:
            cleaned.append((kept, block, section, shaped_input(value, rules)))
    return cleaned, [value for value, _, _ in raw]


def _read_rules(mapping: dict[str, Any], label_sections: list[dict[str, Any]], whole: list[dict[str, Any]],
                all_labels: list[str]) -> dict[str, Any]:
    """One field read by its rules: its value and evidence, or why none was kept."""
    rules = mapping.get("rules")
    location = rules["location"] if rules else "auto"
    candidates, raw = _rule_candidates(mapping, rules, label_sections, whole, all_labels)
    candidates.sort(key=lambda item: (item[1].get("pageNumber") or 0, item[1].get("blockPk") or 0))
    distinct = list(dict.fromkeys(value for value, *_ in candidates))
    # A document has many headings: the first one (matching the pattern, if any) is the one meant.
    take_first = location == "heading" or bool(rules and rules.get("occurrence") == "first")
    if len(distinct) == 1 or (distinct and take_first):
        value, block, section, source = candidates[0]
        return {"value": value, "block": block, "section": section, "reason": "found", "raw": source}
    if len(distinct) > 1:
        return {"reason": "several_values", "values": distinct[:5]}
    if raw:
        return {"reason": "pattern_mismatch" if rules and rules.get("pattern") else "no_value",
                "values": raw[:5]}
    if location == "heading":
        return {"reason": "no_heading"}
    if location == "anywhere":
        return {"reason": "no_match"}
    if location == "pages":
        return {"reason": "no_page"}
    labels = _mapping_labels(mapping)
    if location in PASSAGE_LOCATIONS:
        mentioned = any(label_found(block["content"], labels)
                        or heading_matches(str(section.get("title") or ""), labels)
                        for block, section in _usable_blocks(whole))
        return {"reason": "no_value" if mentioned else "label_not_found"}
    mentioned = any(label_found(block["content"], labels) for block, _ in _usable_blocks(label_sections))
    return {"reason": "no_value" if mentioned else "label_not_found"}


async def read_document_values(
    connection: Any, entry: dict[str, Any], asset_ref: dict[str, Any], capabilities: dict[str, Any],
    document_pk: Any, *, model_id: str = "", ai_extraction: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Read the extracted fields of one indexed document: by rules, by AI, or by rules then AI.

    Returns the values, their evidence, and for each extracted field how it was read or why it
    was not, so a person can see what to change.
    """
    values: dict[str, Any] = {}
    evidence_by_field: dict[str, dict[str, Any]] = {}
    fields: dict[str, dict[str, Any]] = {}
    quotes: dict[str, str] = {}
    # The text each rule's location found, before it was shaped: shown when a person shapes the value.
    raws: dict[str, str] = {}
    extract = [m for m in entry["fieldMappings"] if m["mode"] == "extract"]
    rule_mappings = [m for m in extract if _strategy(m) in ("deterministic", "rules_then_ai")]
    settings = normalize_ai_settings((entry.get("options") or {}).get("aiSettings"))

    whole_cache: list[list[dict[str, Any]]] = []

    async def whole() -> list[dict[str, Any]]:
        if not whole_cache:
            whole_cache.append(await _whole_document(connection, document_pk))
        return whole_cache[0]

    search_truncated = False
    read = None
    label_mappings = [m for m in rule_mappings
                      if ((m.get("rules") or {}).get("location") or "auto")
                      not in ("heading", "anywhere", *PASSAGE_LOCATIONS)]
    hits: list[dict[str, Any]] = []
    for mapping in label_mappings:
        for label in _mapping_labels(mapping):
            exact = await search_exact(connection, document_pk=document_pk, value=label)
            search_truncated = search_truncated or exact["truncated"]
            lexical_hits: list[dict[str, Any]] = []
            if capabilities["capabilities"].get("lexical"):
                try:
                    lexical = await search_lexical(
                        connection, document_pk=document_pk, query=label,
                        capabilities=capabilities["capabilities"])
                    lexical_hits = lexical["hits"]
                    search_truncated = search_truncated or lexical["truncated"]
                except LogicalSearchError:
                    lexical_hits = []
            hits = combine_hits(hits, exact["hits"], lexical_hits)
    if len(hits) > MAX_CLOSURE_SECTIONS:
        hits = hits[:MAX_CLOSURE_SECTIONS]
        search_truncated = True
    label_sections: list[dict[str, Any]] = []
    if hits:
        read = await read_complete_section_set(
            connection, document_pk=document_pk,
            section_pks=[hit["sectionPk"] for hit in hits], include_descendants=True)
        label_sections = read["sections"]
    all_labels = [label for mapping in label_mappings for label in _mapping_labels(mapping)]
    for mapping in rule_mappings:
        location = (mapping.get("rules") or {}).get("location") or "auto"
        document = await whole() if location in ("heading", "anywhere", *PASSAGE_LOCATIONS) else []
        outcome = _read_rules(mapping, label_sections, document, all_labels)
        key = mapping["targetAttribute"]
        if outcome["reason"] == "found":
            values[key] = outcome["value"]
            evidence_by_field[key] = _evidence(
                outcome["block"], outcome["section"], str(outcome["block"].get("content") or ""),
                asset_ref, entry["mappingVersion"])
            fields[key] = {"method": "rules", "reason": "found",
                           **({"pageEnd": outcome["block"]["lastPageNumber"]}
                              if outcome["block"].get("lastPageNumber") is not None else {})}
            quotes[key] = str(outcome["block"].get("content") or "")[:600]
            raws[key] = outcome["raw"][:MAX_RAW_CHARS]
        else:
            if outcome.get("values"):
                raws[key] = shaped_input(str(outcome["values"][0]), mapping.get("rules"))[:MAX_RAW_CHARS]
            fields[key] = {"method": "rules",
                           **{name: item for name, item in outcome.items() if name in ("reason", "values")}}

    ai_mappings = [m for m in extract if _strategy(m) == "ai"
                   or (_strategy(m) == "rules_then_ai" and m["targetAttribute"] not in values)]
    ai_failure: str | None = None
    ai_sent: dict[str, Any] | None = None
    # A mapping can read several records from one document (each line of a table, each message).
    many = ((entry.get("options") or {}).get("aiSettings") or {}).get("manyRecords") is True
    records: list[dict[str, Any]] | None = [] if ai_mappings and many else None
    if ai_mappings:
        try:
            document = await whole()
        except SectionReadError as exc:
            ai_failure, document = exc.code, []
        if ai_failure is None:
            ai_failure, ai_sent = await _apply_ai_extraction(
                entry, asset_ref, document, ai_mappings, model_id, ai_extraction,
                values, evidence_by_field, settings, quotes, records)
        for mapping in ai_mappings:
            key = mapping["targetAttribute"]
            earlier = fields.get(key)
            if key in values:
                fields[key] = {"method": "ai", "reason": "found"}
            else:
                fields[key] = {"method": "ai", "reason": "ai_failed" if ai_failure else "ai_not_found",
                               **({"detail": ai_failure} if ai_failure else {}),
                               **({"rules": earlier} if earlier else {})}
    return {"values": values, "evidence": evidence_by_field, "fields": fields, "quotes": quotes, "raws": raws,
            "aiMappings": ai_mappings, "aiFailure": ai_failure, "aiSent": ai_sent, "records": records or [],
            "readComplete": bool(read is None or read["coverage"]["directBlocksComplete"]),
            "searchTruncated": search_truncated}


async def resolve_indexed_document(
    connection: Any, entry: dict[str, Any], actor_user_id: str,
    metadata_fetch: Callable[[dict[str, Any], str], Awaitable[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    """Reauthorize a document and find it in the logical index; "gap" holds why it cannot be read."""
    source = entry["source"]
    asset_ref = resolve_asset_ref(source)
    try:
        current = await (metadata_fetch or fetch_workspace_asset_metadata)(source, actor_user_id)
    except AssetFetchError as exc:
        return {"gap": _gap(entry, "source_unavailable", exc.code, asset_ref)}
    asset_ref = resolve_asset_ref(current)
    capabilities = await detect_capabilities(connection)
    if (not capabilities["capabilities"].get("structure")
            or current.get("indexingStatus") not in {"ready", "completed"}):
        observation = build_index_observation(
            asset_ref=asset_ref, document_pk=None,
            capabilities=capabilities["capabilities"], fingerprint=current.get("contentHash"))
        result = _gap(entry, "index_unavailable", "logical index is not ready", asset_ref)
        result["indexObservation"] = observation
        return {"gap": result}
    resolution = await resolve_document_candidates(
        connection, workspace_id=current["workspaceId"], file_name=current["originalName"],
        uploader_user_id=current.get("uploaderUserId"))
    candidate = resolution["candidates"][0] if resolution["resolution"] == "resolved" else None
    observation = build_index_observation(
        asset_ref=asset_ref, document_pk=candidate["documentPk"] if candidate else None,
        capabilities=capabilities["capabilities"], fingerprint=current.get("contentHash"))
    if resolution["resolution"] != "resolved":
        status = "index_ambiguous" if resolution["resolution"] == "ambiguous" else "index_unavailable"
        result = _gap(entry, status, f"logical index correlation is {resolution['resolution']}", asset_ref)
        result["indexObservation"] = observation
        return {"gap": result}
    return {"current": current, "assetRef": asset_ref, "capabilities": capabilities,
            "candidate": candidate, "observation": observation, "resolution": resolution}


async def populate_document(
    connection: Any, entry: dict[str, Any], concept: dict[str, Any], actor_user_id: str,
    *, metadata_fetch: Callable[[dict[str, Any], str], Awaitable[dict[str, Any]]] | None = None,
    model_id: str = "", ai_extraction: dict[str, Any] | None = None,
    cache: Any | None = None,
) -> dict[str, Any]:
    """Reauthorize, correlate, retrieve, and populate one mapped document.

    With a cache, a document whose content, mapping, concept and extractor are unchanged
    reuses its previous result (marked "reused"). Access and index correlation are still
    checked every time; only reading and extraction are skipped.
    """
    resolved = await resolve_indexed_document(connection, entry, actor_user_id, metadata_fetch)
    if "gap" in resolved:
        return resolved["gap"]
    current, asset_ref, capabilities = resolved["current"], resolved["assetRef"], resolved["capabilities"]
    candidate, observation, resolution = resolved["candidate"], resolved["observation"], resolved["resolution"]

    cache_key = None
    if cache is not None:
        from app.persistence.extraction_cache import extraction_cache_key
        options = entry.get("options") or {}
        cache_key = extraction_cache_key({
            "engine": DOCUMENT_EXTRACTION_VERSION, "modelId": model_id, "concept": concept,
            "conceptId": entry["conceptId"], "fieldMappings": entry["fieldMappings"],
            "mappingVersion": entry["mappingVersion"], "labelField": entry.get("labelField"),
            "assetRef": asset_ref, "contentHash": current.get("contentHash"),
            "documentPk": candidate["documentPk"], "aiExtraction": ai_extraction,
            **({"options": options} if options else {})})
        cached = await cache.get(cache_key)
        if cached is not None:
            cached["indexObservation"] = observation
            cached["reused"] = True
            return cached

    values: dict[str, Any] = {}
    evidence_by_field: dict[str, dict[str, Any]] = {}
    for mapping in entry["fieldMappings"]:
        if mapping["mode"] == "metadata":
            values[mapping["targetAttribute"]] = _metadata_value(current, mapping["sourceField"])
            evidence_by_field[mapping["targetAttribute"]] = {
                "assetRef": asset_ref, "origin": "metadata", "extractorVersion": "metadata-v1",
                "mappingVersion": entry["mappingVersion"]}
        elif mapping["mode"] == "constant":
            values[mapping["targetAttribute"]] = mapping.get("constantValue")
            evidence_by_field[mapping["targetAttribute"]] = {
                "assetRef": asset_ref, "origin": "human", "extractorVersion": "constant-v1",
                "mappingVersion": entry["mappingVersion"]}

    # AI extraction must finish before the row is turned into entities, otherwise
    # the resolved values would never reach the assertions.
    extracted = await read_document_values(
        connection, entry, asset_ref, capabilities, candidate["documentPk"],
        model_id=model_id, ai_extraction=ai_extraction)
    ai_failure = extracted["aiFailure"]
    ai_keys = {mapping["targetAttribute"] for mapping in extracted["aiMappings"]}
    # Computed fields come last: they read the file name or a value read just above.
    computed = [{**m, "computed": normalize_computed(m.get("computed"))}
                for m in entry["fieldMappings"] if m["mode"] == "computed"]
    context = {"document_name": current.get("originalName")}
    computed_evidence = {"assetRef": asset_ref, "origin": "metadata", "extractorVersion": COMPUTED_VERSION,
                         "mappingVersion": entry["mappingVersion"]}
    # A recipe joining several parts names every field (or the file) it read.
    joined_sources = {m["targetAttribute"]: recipe_sources(m["computed"]) for m in computed
                      if m["computed"]["input"]["kind"] == "join"}

    def computed_evidence_of(field: str) -> dict[str, Any]:
        return ({**computed_evidence, "recipeSources": joined_sources[field]} if field in joined_sources
                else computed_evidence)
    source_ref = {"assetRef": asset_ref, "mappingVersion": entry["mappingVersion"],
                  "labelField": entry.get("labelField")}

    if extracted["records"]:
        # Several records: what the document says once (metadata, constants, rules) is shared by
        # every record, and each item the AI found adds its own values. Row n is the n-th item.
        values.update({key: value for key, value in extracted["values"].items() if key not in ai_keys})
        evidence_by_field.update({key: item for key, item in extracted["evidence"].items() if key not in ai_keys})
        shared, shared_evidence = dict(values), dict(evidence_by_field)
        rows: list[dict[str, Any]] = []
        evidence_by_row: dict[int, dict[str, dict[str, Any]]] = {}
        computed_outcomes: dict[str, dict[str, Any]] = {}
        for number, record in enumerate(extracted["records"], start=1):
            row_values = {**shared, **record["values"]}
            row_evidence = {**shared_evidence, **record["evidence"]}
            for field, outcome in apply_computed(computed, row_values, context).items():
                if outcome["reason"] == "found":
                    row_evidence[field] = computed_evidence_of(field)
                # A computed field counts as found when any record found it.
                if field not in computed_outcomes or outcome["reason"] == "found":
                    computed_outcomes[field] = outcome
            evidence_by_row[number] = {key: {**item, "rowNumber": number} for key, item in row_evidence.items()}
            rows.append({**row_values, "_row": number})
            for key, value in row_values.items():
                values.setdefault(key, value)
        output = populate_concept_rows(concept, rows, source_ref)
        for assertion in output["assertions"]:
            assertion["evidence"] = evidence_by_row[assertion["evidence"]["rowNumber"]][assertion["attribute"]]
            assertion["origin"] = "human" if assertion["evidence"]["origin"] == "human" else "source"
    else:
        values.update(extracted["values"])
        evidence_by_field.update(extracted["evidence"])
        computed_outcomes = apply_computed(computed, values, context)
        for field, outcome in computed_outcomes.items():
            if outcome["reason"] == "found":
                evidence_by_field[field] = computed_evidence_of(field)
        output = populate_concept_rows(concept, [{**values, "_row": None}], source_ref)
        for assertion in output["assertions"]:
            assertion["evidence"] = evidence_by_field[assertion["attribute"]]
            assertion["origin"] = "human" if assertion["evidence"]["origin"] == "human" else "source"
    extract_mappings = [m for m in entry["fieldMappings"] if m["mode"] == "extract"]
    missing_fields = [m["targetAttribute"] for m in extract_mappings if m["targetAttribute"] not in values]
    for field, outcome in computed_outcomes.items():
        if outcome["reason"] != "found":
            output["gaps"].append({"kind": "unresolved_document_field", "conceptId": entry["conceptId"],
                                   "rowNumber": None, "field": field, "assetRef": asset_ref,
                                   "detail": f"field '{field}' could not be computed ({outcome['reason']})"})
    for field in missing_fields:
        if field in ai_keys:
            continue
        output["gaps"].append({"kind": "unresolved_document_field", "conceptId": entry["conceptId"],
                               "rowNumber": None, "detail": f"field '{field}' was not resolved",
                               "field": field, "assetRef": asset_ref})
    for field in missing_fields:
        if field not in ai_keys:
            continue
        # Never silently fall back to deterministic values when AI was requested.
        if ai_failure is not None:
            output["gaps"].append({"kind": "ai_extraction_unavailable", "conceptId": entry["conceptId"],
                                   "rowNumber": None, "field": field, "assetRef": asset_ref,
                                   "detail": f"AI extraction failed for '{field}': {ai_failure}"})
        else:
            output["gaps"].append({"kind": "ai_extraction_unresolved", "conceptId": entry["conceptId"],
                                   "rowNumber": None, "field": field, "assetRef": asset_ref,
                                   "detail": f"field '{field}' was not grounded by the extraction agent"})
    complete = extracted["readComplete"]
    if not complete:
        output["gaps"].append({"kind": "budget_exhausted", "conceptId": entry["conceptId"],
                               "rowNumber": None, "scope": "read", "detail": "section evidence exceeded the read budget"})
    if extracted["searchTruncated"]:
        output["gaps"].append({"kind": "budget_exhausted", "conceptId": entry["conceptId"],
                               "rowNumber": None, "scope": "retrieval", "detail": "candidate search exceeded the retrieval budget"})
        complete = False
    output["counts"]["gaps"] = len(output["gaps"])
    if any(gap["kind"] == "missing_identity" for gap in output["gaps"]):
        status = "unresolved_identity"
    elif not complete:
        status = "budget_exhausted"
    elif output["gaps"]:
        status = "processed_with_gaps"
    else:
        status = "processed_complete"
    output.update({"coverage": {"assetRef": asset_ref, "status": status,
                                "fieldsAccepted": sorted(values), "fieldsUnresolved": missing_fields,
                                **({"records": len(extracted["records"])} if extracted["records"] else {}),
                                **({"aiSent": extracted["aiSent"]} if extracted["aiSent"] else {})},
                   "sourceObservation": {"assetRef": asset_ref, "contentHash": current.get("contentHash"),
                                         "sizeBytes": current.get("sizeBytes"),
                                         "indexResolution": resolution["resolution"]},
                   "indexObservation": observation})
    # A failed call to the extraction agent is worth retrying next run; anything else is what this
    # document yields until it, its mapping or the extractor changes.
    if cache_key is not None and not any(gap["kind"] == "ai_extraction_unavailable" for gap in output["gaps"]):
        await cache.put(cache_key, concept_id=entry["conceptId"],
                        asset_id=str(asset_ref.get("assetId") or ""), output=output)
    return output


def _gap(entry: dict[str, Any], status: str, detail: str, asset_ref: dict[str, Any]) -> dict[str, Any]:
    gap = {"kind": status, "conceptId": entry["conceptId"], "rowNumber": None, "detail": detail,
           "assetRef": asset_ref}
    return {"entities": [], "assertions": [], "gaps": [gap],
            "counts": {"scanned": 1, "excluded": 0, "queryable": 0, "materialized": 0, "gaps": 1},
            "coverage": {"assetRef": asset_ref, "status": status,
                         "fieldsAccepted": [], "fieldsUnresolved": [
                             m["targetAttribute"] for m in entry["fieldMappings"]]},
            "sourceObservation": {"assetRef": asset_ref, "indexResolution": status}}
