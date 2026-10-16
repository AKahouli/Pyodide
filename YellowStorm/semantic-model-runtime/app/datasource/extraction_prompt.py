"""Runtime-owned extraction instructions migrated from the ADK NodeExtractor."""

from __future__ import annotations

import json
import re
import unicodedata
from typing import Any

PROMPT_VERSION = "semantic-attributes-v2"
_FILE_EXTENSION_RE = re.compile(
    r"\.(pdf|docx?|xlsx?|pptx?|txt|md|html?|json|xml|csv|odt|ods|rtf|eml|msg|zip|tar|gz)$", re.IGNORECASE)
_PLACEHOLDER_VALUES = {
    "null", "none", "nil", "n/a", "na", "unknown", "not found", "not_found",
    "missing", "empty", "-", "--", "aucun", "aucune", "inconnu", "inconnue",
}


def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFC", text)
    text = (text.replace("\u2018", "'").replace("\u2019", "'")
                .replace("\u201c", '"').replace("\u201d", '"')
                .replace("\u2013", "-").replace("\u2014", "--").replace("\u2026", "..."))
    text = text.replace("\t", " ").replace("\r\n", "\n").replace("\r", "\n")
    return re.sub(r"\n\s*\n", "\n\n", re.sub(r" +", " ", text)).strip()


def looks_like_filename(text: str) -> bool:
    return bool(_FILE_EXTENSION_RE.search(text))


def meaningful_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        text = value.strip()
        return bool(text) and text.casefold() not in _PLACEHOLDER_VALUES and not looks_like_filename(text)
    if isinstance(value, (list, dict)):
        return bool(value)
    return True


def extraction_prompt(concept: dict[str, Any], evidence: list[dict[str, str]], file_name: str,
                      *, allow_generated_values: bool = False) -> str:
    """Bump PROMPT_VERSION whenever these instructions change."""
    source_note = (f'Source file: "{file_name}" — NEVER use this filename as a label or attribute value.\n'
                   if file_name else "")
    return (
        "Extract structured entities from the evidence text below.\n"
        + source_note + "\n"
        "CONCEPTS TO EXTRACT (return one 'extractions' entry per concept, even if empty):\n"
        + json.dumps([concept], ensure_ascii=False, indent=2) + "\n\n"
        "Return JSON with EXACTLY this shape:\n"
        "{\n"
        '  "extractions": [\n'
        '    {\n'
        '      "conceptKey": "<the conceptKey from above>",\n'
        '      "instances": [\n'
        '        {\n'
        '          "label": "<proper name identifying this specific instance>",\n'
        '          "attributes": [\n'
        '            {"key": "<attribute key>", "value": "<requested typed value>", "evidenceReferences": ["<ref>"]}\n'
        '          ],\n'
        '          "evidenceReferences": ["<ref>"],\n'
        '          "confidence": 0.0\n'
        '        }\n'
        '      ]\n'
        '    }\n'
        '  ]\n'
        "}\n\n"
        "Rules (STRICT):\n"
        "- ALWAYS return one 'extractions' entry per concept in CONCEPTS TO EXTRACT, even when no instance is found (use \"instances\": []).\n"
        "- Instances count is unrestricted: 0, 1, or many per concept.\n"
        "- label: the proper name or title that identifies this specific instance.\n"
        "  * Person → full name. Company → registered name. Contract → title or reference. Never a role, category, or email.\n"
        "  * NEVER a filename (ending in .pdf, .docx, etc).\n"
        + ("- Return values according to each field's definition and type. You may summarize, combine passages or normalize formatting; cite the supplied passages used. No fabrication, no 'N/A', no 'unknown'.\n"
           if allow_generated_values else
           "- Attribute values must appear verbatim (or lightly normalized) in the evidence. No fabrication, no 'N/A', no 'unknown'.\n")
        + "- Omit attributes with no value found — do not send empty strings.\n"
        "- evidenceReferences must be exact 'reference' strings copied from the evidence entries used.\n"
        "- Split comma/semicolon/bullet lists into separate instances when they describe distinct items.\n\n"
        "EVIDENCE:\n" + json.dumps(evidence, ensure_ascii=False)
    )
