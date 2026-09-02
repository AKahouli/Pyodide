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
        concurrency: int = 8,
        batch_size: int = 6,
    ) -> list[dict[str, Any]]:
        """Extract raw nodes from evidence.

        Strategy: batch per document. Each LLM call extracts multiple concepts from
        ONE document at once, cutting call count from N×M (concepts × docs) to
        roughly M×ceil(N/batch_size). If batch_size=1 the behaviour is per-concept
        (legacy). Larger batches are faster but risk small models dropping concepts;
        the FAILURE_THRESHOLD safety net still catches major issues.
        """
        node_types = {
            node["id"]: node
            for node in graph.get("nodes", [])
            if isinstance(node, dict) and node.get("id")
        }
        doc_batches = self._build_doc_batches(node_types, search_tasks, normalize_text, batch_size)
        if not doc_batches:
            return []

        total_units = sum(len(batch["node_types"]) for batch in doc_batches)
        raw: list[dict[str, Any]] = []
        failed_units: list[str] = []

        max_workers = max(1, min(concurrency, len(doc_batches)))
        logger.info(
            "Node extraction: %d batches (docs), %d units total, concurrency=%d, batch_size=%d",
            len(doc_batches), total_units, max_workers, batch_size,
        )

        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {pool.submit(self._process_doc_batch, batch, llm): batch for batch in doc_batches}
            for future in concurrent.futures.as_completed(futures):
                batch = futures[future]
                try:
                    nodes, batch_failed_units = future.result()
                    raw.extend(nodes)
                    failed_units.extend(batch_failed_units)
                except Exception:
                    logger.exception(
                        "Extraction batch crashed file=%s concepts=%s",
                        batch["file_name"],
                        [nt.get("id") for nt in batch["node_types"]],
                    )
                    for nt in batch["node_types"]:
                        failed_units.append(f"{nt.get('id')}:{batch['file_name']}")

        failure_rate = len(failed_units) / total_units if total_units else 0
        if failure_rate >= self.FAILURE_THRESHOLD:
            raise ExtractionPartialFailureError(
                f"{len(failed_units)}/{total_units} extraction units failed "
                f"(threshold {self.FAILURE_THRESHOLD:.0%}): {failed_units}"
            )
        if failed_units:
            logger.warning(
                "Partial extraction: %d/%d units failed (below abort threshold): %s",
                len(failed_units), total_units, failed_units,
            )

        return raw

    # ── batching per document (fast path) ──────────────────────────────────

    def _build_doc_batches(
        self,
        node_types: dict[str, dict[str, Any]],
        search_tasks: list[dict[str, Any]],
        normalize_text: Any,
        batch_size: int,
    ) -> list[dict[str, Any]]:
        """Group tasks by document, then chunk the concepts per doc into batches.

        Each batch = 1 LLM call covering one document and up to `batch_size` concepts.
        """
        # Step 1: group by (file_name, source_document_id)
        grouped: dict[tuple[str, str], dict[str, Any]] = {}
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
            key = (task.get("fileName", ""), task.get("sourceDocumentId", ""))
            entry = grouped.setdefault(key, {
                "file_name": key[0],
                "source_document_id": key[1],
                "node_types": [],
                "evidence_items": [],
                "_seen_evidence": set(),
                "_seen_type_ids": set(),
            })
            if node_type["id"] not in entry["_seen_type_ids"]:
                entry["node_types"].append(node_type)
                entry["_seen_type_ids"].add(node_type["id"])
            for item in evidence_items:
                evidence_key = (item.get("reference") or "", (item.get("quote") or "")[:200])
                if evidence_key in entry["_seen_evidence"]:
                    continue
                entry["_seen_evidence"].add(evidence_key)
                entry["evidence_items"].append(item)

        # Step 2: chunk concepts per doc to keep prompts manageable for small models
        batches: list[dict[str, Any]] = []
        chunk_size = max(1, batch_size)
        for entry in grouped.values():
            entry.pop("_seen_evidence", None)
            entry.pop("_seen_type_ids", None)
            concepts = entry["node_types"]
            for chunk_start in range(0, len(concepts), chunk_size):
                batches.append({
                    "file_name": entry["file_name"],
                    "source_document_id": entry["source_document_id"],
                    "node_types": concepts[chunk_start:chunk_start + chunk_size],
                    "evidence_items": entry["evidence_items"],
                })
        return batches

    def _process_doc_batch(
        self, batch: dict[str, Any], llm: Any,
    ) -> tuple[list[dict[str, Any]], list[str]]:
        """Run 1 LLM call to extract all concepts of `batch` from the doc's evidence.

        Returns (nodes, failed_units). Any concept the LLM omits is marked failed.
        """
        node_types_in_batch = batch["node_types"]
        file_name = batch["file_name"]
        source_document_id = batch["source_document_id"]
        prompt = self._batch_prompt(node_types_in_batch, batch["evidence_items"], file_name)

        try:
            result = llm.generate_structured(prompt)
        except Exception:
            logger.exception(
                "LLM batch extraction failed file=%s concepts=%s",
                file_name, [nt.get("id") for nt in node_types_in_batch],
            )
            return [], [f"{nt.get('id')}:{file_name}" for nt in node_types_in_batch]

        if not isinstance(result, dict):
            logger.warning("LLM returned non-dict for batch file=%s: %r", file_name, result)
            return [], [f"{nt.get('id')}:{file_name}" for nt in node_types_in_batch]

        extractions = result.get("extractions")
        if not isinstance(extractions, list):
            logger.warning("LLM batch missing 'extractions' list file=%s: keys=%s", file_name, list(result.keys()))
            return [], [f"{nt.get('id')}:{file_name}" for nt in node_types_in_batch]

        # Index by conceptKey — support both 'key' and 'id' as identifiers
        type_by_key: dict[str, dict[str, Any]] = {}
        for nt in node_types_in_batch:
            for k in (nt.get("key"), nt.get("id"), nt.get("label")):
                if isinstance(k, str) and k.strip():
                    type_by_key[k.strip().casefold()] = nt

        nodes: list[dict[str, Any]] = []
        seen_type_ids: set[str] = set()
        for extraction in extractions:
            if not isinstance(extraction, dict):
                continue
            concept_key = str(extraction.get("conceptKey") or "").strip().casefold()
            node_type = type_by_key.get(concept_key)
            if not node_type:
                logger.info("Batch response has unknown conceptKey=%r file=%s", concept_key, file_name)
                continue
            seen_type_ids.add(node_type["id"])
            instances = extraction.get("instances")
            if not isinstance(instances, list):
                continue
            for instance in instances:
                if not isinstance(instance, dict):
                    continue
                extracted_node = self._instance_to_node(instance, node_type, file_name, source_document_id)
                if extracted_node is not None:
                    nodes.append(extracted_node)

        failed_units = [
            f"{nt.get('id')}:{file_name}"
            for nt in node_types_in_batch if nt["id"] not in seen_type_ids
        ]
        return nodes, failed_units

    def _instance_to_node(
        self,
        instance: dict[str, Any],
        node_type: dict[str, Any],
        file_name: str,
        source_document_id: str,
    ) -> dict[str, Any] | None:
        label = str(instance.get("label") or "").strip()
        if not label or self._looks_like_filename(label):
            return None
        raw_attributes = instance.get("attributes") or []
        attributes: list[dict[str, Any]] = []
        # Support both dict-shape and list-of-dicts responses
        if isinstance(raw_attributes, dict):
            raw_attributes = [{"key": k, "value": v} for k, v in raw_attributes.items()]
        for a in raw_attributes:
            if not isinstance(a, dict):
                continue
            key = a.get("key")
            value = a.get("value")
            if not isinstance(key, str) or not key.strip():
                continue
            if not is_meaningful_value(value):
                continue
            if self._looks_like_filename(str(value)):
                continue
            attributes.append({
                "key": key.strip(),
                "value": value,
                "evidenceReferences": [str(r) for r in a.get("evidenceReferences", [])],
            })
        return {
            "id": f"node-{uuid.uuid4()}",
            "nodeTypeId": node_type["id"],
            "label": label,
            "attributes": attributes,
            "evidenceReferences": [str(r) for r in instance.get("evidenceReferences", [])],
            "confidence": float(instance.get("confidence") or 0.0),
            "_sourceDocumentIds": [source_document_id] if source_document_id else [],
            "_fileName": file_name,
        }

    # ── private (legacy per-concept path, kept as fallback) ────────────────

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
    def _batch_prompt(
        node_types: list[dict[str, Any]],
        evidence_items: list[dict[str, Any]],
        file_name: str,
    ) -> str:
        """Prompt that asks the LLM to extract several concepts from one document
        in a single call. Response schema keeps concepts grouped so we can map
        each instance back to its node_type deterministically."""
        concept_specs: list[dict[str, Any]] = []
        for nt in node_types:
            attributes = []
            for a in nt.get("attributes") or []:
                if not isinstance(a, dict) or not a.get("key"):
                    continue
                attr_spec = {"key": a["key"]}
                if a.get("label") and a["label"] != a["key"]:
                    attr_spec["label"] = a["label"]
                if a.get("type"):
                    attr_spec["type"] = a["type"]
                if a.get("description"):
                    attr_spec["description"] = a["description"]
                if a.get("required"):
                    attr_spec["required"] = True
                if a.get("options"):
                    attr_spec["allowed_values"] = list(a["options"])
                attributes.append(attr_spec)
            concept_specs.append({
                "conceptKey": nt.get("key") or nt.get("id"),
                "label": nt.get("label") or nt.get("key") or "",
                "description": nt.get("description") or "",
                "aliases": nt.get("aliases") or [],
                "attributes": attributes,
            })

        source_note = (
            f'Source file: "{file_name}" — NEVER use this filename as a label or attribute value.\n'
            if file_name else ""
        )
        return (
            "Extract structured entities from the evidence text below.\n"
            + source_note
            + "\n"
            "CONCEPTS TO EXTRACT (return one 'extractions' entry per concept, even if empty):\n"
            + json.dumps(concept_specs, ensure_ascii=False, indent=2) + "\n\n"
            "Return JSON with EXACTLY this shape:\n"
            "{\n"
            '  "extractions": [\n'
            '    {\n'
            '      "conceptKey": "<the conceptKey from above>",\n'
            '      "instances": [\n'
            '        {\n'
            '          "label": "<proper name identifying this specific instance>",\n'
            '          "attributes": [\n'
            '            {"key": "<attribute key>", "value": "<value verbatim from evidence>", "evidenceReferences": ["<ref>"]}\n'
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
            "- Attribute values must appear verbatim (or lightly normalized) in the evidence. No fabrication, no 'N/A', no 'unknown'.\n"
            "- Omit attributes with no value found — do not send empty strings.\n"
            "- evidenceReferences must be exact 'reference' strings copied from the evidence entries used.\n"
            "- Split comma/semicolon/bullet lists into separate instances when they describe distinct items.\n\n"
            "EVIDENCE:\n"
            + json.dumps(evidence_items, ensure_ascii=False)
        )

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
