"""Stage 1 — LLM attribute extraction per (node_type, document).

Semantica does not extract structured attributes from evidence text against a
custom schema. This module owns the prompts and LLM calls that produce raw
nodes. It never merges or deduplicates — that is Stage 2's responsibility.
"""

from __future__ import annotations

import concurrent.futures
import json
import logging
import re
import uuid
from typing import Any

from .utils import is_meaningful_value, normalize_evidence

_FILE_EXTENSION_RE = re.compile(r"\.\w{2,5}$", re.IGNORECASE)

logger = logging.getLogger(__name__)


class ExtractionPartialFailureError(RuntimeError):
    """Raised when too many extraction units fail LLM calls."""


class NodeExtractor:
    """Run one LLM call per (node_type, document) pair and return raw nodes."""

    # Fraction of units that may fail before the whole extraction is aborted.
    # At or above this threshold an ExtractionPartialFailureError is raised.
    FAILURE_THRESHOLD = 0.5

    def extract(
        self,
        graph: dict[str, Any],
        search_tasks: list[dict[str, Any]],
        llm: Any,
        normalize_text: Any,
    ) -> list[dict[str, Any]]:
        node_types = {
            node["id"]: node
            for node in graph.get("nodes", [])
            if isinstance(node, dict) and node.get("id")
        }
        units = self._build_units(node_types, search_tasks, normalize_text)
        if not units:
            return []

        raw: list[dict[str, Any]] = []
        failed_units: list[str] = []

        with concurrent.futures.ThreadPoolExecutor(max_workers=min(4, len(units))) as pool:
            futures = {pool.submit(self._process_unit, unit, llm): unit for unit in units}
            for future in concurrent.futures.as_completed(futures):
                unit = futures[future]
                try:
                    nodes, unit_failed = future.result()
                    raw.extend(nodes)
                    if unit_failed:
                        failed_units.append(
                            f"{unit['node_type'].get('id')}:{unit['file_name']}"
                        )
                except Exception:
                    logger.exception(
                        "Extraction worker crashed node_type=%s file=%s",
                        unit["node_type"].get("id"), unit["file_name"],
                    )
                    failed_units.append(
                        f"{unit['node_type'].get('id')}:{unit['file_name']}"
                    )

        failure_rate = len(failed_units) / len(units)
        if failure_rate >= self.FAILURE_THRESHOLD:
            raise ExtractionPartialFailureError(
                f"{len(failed_units)}/{len(units)} extraction units failed "
                f"(threshold {self.FAILURE_THRESHOLD:.0%}): {failed_units}"
            )
        if failed_units:
            logger.warning(
                "Partial extraction: %d/%d units failed (below abort threshold): %s",
                len(failed_units), len(units), failed_units,
            )

        return raw

    # ── private ────────────────────────────────────────────────────────────

    def _build_units(
        self,
        node_types: dict[str, dict[str, Any]],
        search_tasks: list[dict[str, Any]],
        normalize_text: Any,
    ) -> list[dict[str, Any]]:
        units = []
        for task in search_tasks:
            target = task.get("target") or {}
            if target.get("kind") != "node_type":
                continue
            node_type = node_types.get(target.get("id"))
            if not node_type:
                continue
            evidence_items = normalize_evidence(task.get("evidence", []), normalize_text)
            if not evidence_items:
                continue
            units.append({
                "node_type": node_type,
                "evidence_items": evidence_items,
                "file_name": task.get("fileName", ""),
                "source_document_id": task.get("sourceDocumentId", ""),
                "is_catalog": len(node_type.get("attributes") or []) <= 1,
            })
        return units

    def _process_unit(self, unit: dict[str, Any], llm: Any) -> tuple[list[dict[str, Any]], bool]:
        """Return (nodes, failed). failed=True means the LLM call errored."""
        if unit["is_catalog"]:
            nodes, failed = self._extract_catalog_nodes(
                node_type=unit["node_type"],
                evidence_items=unit["evidence_items"],
                file_name=unit["file_name"],
                source_document_id=unit["source_document_id"],
                llm=llm,
            )
            return nodes, failed
        node, failed = self._extract_single_node(
            node_type=unit["node_type"],
            evidence_items=unit["evidence_items"],
            file_name=unit["file_name"],
            source_document_id=unit["source_document_id"],
            llm=llm,
        )
        return ([node] if node else []), failed

    def _extract_catalog_nodes(
        self,
        node_type: dict[str, Any],
        evidence_items: list[dict[str, Any]],
        file_name: str,
        source_document_id: str,
        llm: Any,
    ) -> tuple[list[dict[str, Any]], bool]:
        prompt = self._catalog_prompt(node_type, evidence_items, file_name)
        try:
            result = llm.generate_structured(prompt)
        except Exception:
            logger.exception("LLM catalog extraction failed node_type=%s file=%s", node_type.get("id"), file_name)
            return [], True
        if not isinstance(result, dict):
            logger.warning("LLM returned non-dict for catalog node_type=%s file=%s: %r", node_type.get("id"), file_name, result)
            return [], True

        attribute_key = next(
            (a.get("key") for a in (node_type.get("attributes") or []) if a.get("key")), None
        )
        nodes: list[dict[str, Any]] = []
        seen: set[str] = set()
        for instance in result.get("instances", []):
            if not isinstance(instance, dict):
                continue
            label = str(instance.get("label", "")).strip()
            if not label or self._looks_like_filename(label):
                continue
            key = " ".join(label.split()).casefold()
            if key in seen:
                continue
            seen.add(key)
            attributes = []
            if attribute_key:
                attributes.append({
                    "key": attribute_key,
                    "value": label,
                    "evidenceReferences": [str(r) for r in instance.get("evidenceReferences", [])],
                })
            nodes.append({
                "id": f"node-{uuid.uuid4()}",
                "nodeTypeId": node_type["id"],
                "label": label,
                "attributes": attributes,
                "evidenceReferences": [str(r) for r in instance.get("evidenceReferences", [])],
                "confidence": float(instance.get("confidence") or 0.0),
                "_sourceDocumentIds": [source_document_id] if source_document_id else [],
                "_fileName": file_name,
            })
        return nodes, False

    def _extract_single_node(
        self,
        node_type: dict[str, Any],
        evidence_items: list[dict[str, Any]],
        file_name: str,
        source_document_id: str,
        llm: Any,
    ) -> tuple[dict[str, Any] | None, bool]:
        """Return (node_or_None, failed). failed=True only on LLM error, not on legitimate skip."""
        prompt = self._node_prompt(node_type, evidence_items, file_name)
        try:
            result = llm.generate_structured(prompt)
        except Exception:
            logger.exception("LLM node extraction failed node_type=%s file=%s", node_type.get("id"), file_name)
            return None, True
        if not isinstance(result, dict):
            logger.warning("LLM returned non-dict for node_type=%s file=%s: %r", node_type.get("id"), file_name, result)
            return None, True
        # Legitimate skips — evidence did not contain an instance of this concept
        if result.get("skip") is True:
            return None, False
        attributes = [
            a for a in result.get("attributes", [])
            if isinstance(a, dict) and a.get("key")
            and is_meaningful_value(a.get("value"))
            and not self._looks_like_filename(str(a.get("value", "")))
        ]
        if not attributes:
            return None, False
        raw_label = str(result.get("label") or "").strip() or None
        if not raw_label:
            logger.info(
                "Node skipped: no label node_type=%s file=%s",
                node_type.get("id"), file_name,
            )
            return None, False
        if self._looks_like_filename(raw_label):
            logger.info(
                "Node skipped: label looks like filename '%s' node_type=%s file=%s",
                raw_label, node_type.get("id"), file_name,
            )
            return None, False
        return {
            "id": f"node-{uuid.uuid4()}",
            "nodeTypeId": node_type["id"],
            "label": raw_label,
            "attributes": [
                {"key": a["key"], "value": a["value"],
                 "evidenceReferences": [str(r) for r in a.get("evidenceReferences", [])]}
                for a in attributes
            ],
            "evidenceReferences": [str(r) for r in result.get("evidenceReferences", [])],
            "confidence": float(result.get("confidence") or 0.0),
            "_sourceDocumentIds": [source_document_id] if source_document_id else [],
            "_fileName": file_name,
        }, False

    # ── helpers ─────────────────────────────────────────────────────────────

    @staticmethod
    def _looks_like_filename(label: str) -> bool:
        """Return True if the label looks like a file name rather than a concept value."""
        return bool(_FILE_EXTENSION_RE.search(label))

    # ── prompts ─────────────────────────────────────────────────────────────

    @staticmethod
    def _catalog_prompt(node_type: dict[str, Any], evidence_items: list[dict[str, Any]], file_name: str) -> str:
        concept_label = node_type.get("label") or node_type.get("key") or ""
        concept_desc = node_type.get("description") or ""
        return (
            f'Extract every distinct instance of "{concept_label}" found in the evidence.\n'
            + (f'Definition: {concept_desc}\n' if concept_desc else "")
            + "\n"
            "Return JSON:\n"
            '{"instances": [{"label": "...", "evidenceReferences": ["..."], "confidence": 0.0}]}\n\n'
            "Rules:\n"
            "- Only include items that genuinely match the definition above.\n"
            "- label = the proper name or title that identifies this specific instance.\n"
            "  * For a person: use their full name, never their email, role, or job title.\n"
            "  * For any entity: prefer a proper name over a role, category, or identifier code.\n"
            "  * Never a full sentence, verb phrase, or attribute value.\n"
            "- Split comma/semicolon/bullet-separated lists into one instance per item.\n"
            "- Never invent. Every label must appear in the evidence.\n"
            "- evidenceReferences must be `reference` strings from the evidence.\n\n"
            "EVIDENCE:\n"
            + json.dumps(evidence_items, ensure_ascii=False)
        )

    @staticmethod
    def _node_prompt(node_type: dict[str, Any], evidence_items: list[dict[str, Any]], file_name: str) -> str:
        concept_label = node_type.get("label") or node_type.get("key") or ""
        concept_desc = node_type.get("description") or ""
        aliases = node_type.get("aliases")

        attr_lines = []
        for a in (node_type.get("attributes") or []):
            if not isinstance(a, dict) or not a.get("key"):
                continue
            parts = [f'  {a["key"]}']
            if a.get("label") and a["label"] != a["key"]:
                parts[0] += f' ({a["label"]})'
            if a.get("type"):
                parts[0] += f' [{a["type"]}]'
            if a.get("description"):
                parts[0] += f': {a["description"]}'
            if a.get("required"):
                parts[0] += " *required*"
            if a.get("options"):
                parts[0] += f' — allowed values: {", ".join(str(o) for o in a["options"])}'
            attr_lines.append(parts[0])

        source_note = f'Source file: "{file_name}" — do NOT use this filename as a label or attribute value.\n' if file_name else ""
        return (
            f'Extract ONE instance of "{concept_label}" from the evidence below.\n'
            + (f'Definition: {concept_desc}\n' if concept_desc else "")
            + (f'Also known as: {", ".join(aliases)}\n' if aliases else "")
            + source_note
            + "\n"
            "FIELDS TO EXTRACT:\n"
            + "\n".join(attr_lines) + "\n\n"
            "Return JSON:\n"
            '{"label": "<proper name or title that identifies this specific instance>", '
            '"attributes": [{"key": "...", "value": "...", "evidenceReferences": ["..."]}], '
            '"evidenceReferences": ["..."], "confidence": 0.0}\n'
            'If the evidence does not describe an instance of this concept, return {"skip": true}.\n\n'
            "Rules:\n"
            f'- Extract if the evidence contains data about a {concept_label} — including when the document is authored by or focused on that entity.\n'
            "- label: the proper name or title that identifies this specific instance — the name you would use to pick it out of a list.\n"
            "  * For a person: prefer their full name (first + last). If only partial name is found, use it. Never use a job title, role, or position as the label.\n"
            "  * For a document or artifact: use its title or reference code. NEVER use a filename (ending in .pdf, .docx, etc.) as the label.\n"
            "  * For any entity: prefer a proper name over a role, category, email address, or attribute value.\n"
            "  * The label must NOT be a filename, must NOT duplicate the concept type name, and must come from the text content — not from reference identifiers.\n"
            "  * Leave empty string only if absolutely no identifying name is present in the text.\n"
            "- Per field: include only when a value is clearly present in the text. Omit absent fields — no 'N/A' or 'unknown'.\n"
            "- Values must come verbatim (or lightly normalized) from the evidence text. No fabrication.\n"
            "- evidenceReferences must be reference strings from the evidence.\n\n"
            "EVIDENCE:\n"
            + json.dumps(evidence_items, ensure_ascii=False)
        )
