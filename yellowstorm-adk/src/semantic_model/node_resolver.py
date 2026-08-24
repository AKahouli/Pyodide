"""Stage 2 — Node resolution with Semantica's DuplicateDetector.

Replaces all the former custom Tier 0/1/2 logic:
  - Catalog dedup    → DuplicateDetector(similarity_threshold=1.0) — exact match
  - Same-doc merge   → mandatory before dedup (no Semantica equivalent for provenance)
  - Cross-doc dedup  → DuplicateDetector(similarity_threshold=0.80..0.90)
  - Suggestions      → DuplicateDetector groups below AUTO_MERGE_CONFIDENCE

Only _merge_same_document_nodes and merge_node_pair remain custom because
Semantica has no concept of extraction provenance (source document IDs) and no
schema-aware attribute-union strategy.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from .utils import merge_node_pair, normalize_for_match, to_semantica_entity

_IDENTIFIER_RE = re.compile(r'^(?=.*[a-zA-Z])(?=.*[\d@.\-_]).{5,}$')

logger = logging.getLogger(__name__)

AUTO_MERGE_CONFIDENCE = 0.80
SUGGEST_CONFIDENCE = 0.70


class NodeResolver:
    """Resolve raw extracted nodes into a deduplicated, merged node list."""

    def resolve(
        self,
        raw_nodes: list[dict[str, Any]],
        graph: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        catalog_type_ids = self._catalog_type_ids(graph)

        by_type: dict[str, list[dict[str, Any]]] = {}
        for node in raw_nodes:
            by_type.setdefault(node["nodeTypeId"], []).append(node)

        merge_groups: list[dict[str, Any]] = []
        final_nodes: list[dict[str, Any]] = []

        for type_id, nodes in by_type.items():
            if type_id in catalog_type_ids:
                merged, groups = self._resolve_catalog(nodes)
            else:
                merged, groups = self._resolve_rich(nodes)
            final_nodes.extend(merged)
            merge_groups.extend(groups)

        # Remove catalog nodes whose label matches a rich node label.
        # These are entity names the LLM misclassified as catalog values
        # (e.g. "Marie Dupont" extracted as a Skill when she is an Employé).
        rich_labels = {
            normalize_for_match(n.get("label") or "")
            for n in final_nodes
            if n["nodeTypeId"] not in catalog_type_ids and n.get("label")
        }
        before = len(final_nodes)
        final_nodes = [
            n for n in final_nodes
            if n["nodeTypeId"] not in catalog_type_ids
            or not normalize_for_match(n.get("label") or "")
            or normalize_for_match(n.get("label") or "") not in rich_labels
        ]
        if len(final_nodes) < before:
            logger.info("Removed %d catalog node(s) matching a rich-node label", before - len(final_nodes))

        return final_nodes, merge_groups

    # ── catalog resolution ───────────────────────────────────────────────────

    def _resolve_catalog(
        self, nodes: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Dedup catalog nodes: exact-label first, then Semantica for fuzzy variants."""
        if len(nodes) < 2:
            return nodes, []

        # Always run exact-label dedup first — reliable, cross-document.
        # DuplicateDetector alone can miss cross-document duplicates when it factors
        # in _sourceDocumentId during similarity scoring.
        nodes, exact_groups = self._fallback_catalog_dedup(nodes)
        logger.info("Catalog exact dedup: %d unique nodes", len(nodes))

        if len(nodes) < 2:
            return nodes, exact_groups

        try:
            from semantica.deduplication import DuplicateDetector
        except ImportError:
            return nodes, exact_groups

        # Fuzzy pass for slight spelling variants (threshold < 1.0).
        detector = DuplicateDetector(similarity_threshold=0.90, confidence_threshold=0.85)
        try:
            groups = detector.detect_duplicate_groups(
                [to_semantica_entity(n) for n in nodes]
            ) or []
        except Exception:
            logger.exception("DuplicateDetector failed for catalog nodes (fuzzy pass)")
            return nodes, exact_groups

        merged_nodes, fuzzy_groups = self._apply_groups(nodes, groups, auto=True, reason="similar catalog name")
        return merged_nodes, exact_groups + fuzzy_groups

    def _fallback_catalog_dedup(
        self, nodes: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        clusters: dict[str, list[dict[str, Any]]] = {}
        for node in nodes:
            clusters.setdefault(normalize_for_match(node.get("label") or ""), []).append(node)
        merged_nodes, groups = [], []
        for members in clusters.values():
            if len(members) == 1:
                merged_nodes.append(members[0])
                continue
            members.sort(key=lambda n: len(n.get("attributes", [])), reverse=True)
            canonical = members[0]
            for fragment in members[1:]:
                canonical = merge_node_pair(canonical, fragment)
            merged_nodes.append(canonical)
            groups.append({
                "canonicalNodeId": canonical["id"],
                "mergedNodeIds": [m["id"] for m in members[1:]],
                "reason": "Merged automatically: identical catalog name",
            })
        return merged_nodes, groups

    # ── rich node resolution ─────────────────────────────────────────────────

    def _resolve_rich(
        self, nodes: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Resolve rich nodes: same-doc merge first, then Semantica dedup."""
        if len(nodes) < 2:
            return nodes, []

        # Mandatory: merge extraction fragments from the same source document.
        # Each (binding × document) search call produces one partial node — they
        # MUST be merged before cross-document dedup runs.
        nodes, same_doc_groups = self._merge_same_document_nodes(nodes)

        if len(nodes) < 2:
            return nodes, same_doc_groups

        # Exact-label merge: two nodes with identical labels represent the same
        # entity across documents — merge unconditionally without needing Semantica.
        nodes, label_groups = self._merge_identical_label_nodes(nodes)

        # Shared-identifier merge: two nodes with the same value for the same
        # attribute (e.g. employee_id=EMP-042) are the same entity even when
        # their labels differ (one extraction may use an ID as its label).
        nodes, attr_groups = self._merge_by_shared_attribute(nodes)

        if len(nodes) < 2:
            return nodes, same_doc_groups + label_groups + attr_groups

        try:
            from semantica.deduplication import DuplicateDetector
        except ImportError:
            return nodes, same_doc_groups + label_groups

        detector = DuplicateDetector(
            similarity_threshold=SUGGEST_CONFIDENCE,
            confidence_threshold=SUGGEST_CONFIDENCE,
        )
        try:
            dup_groups = detector.detect_duplicate_groups(
                [to_semantica_entity(n) for n in nodes]
            ) or []
        except Exception:
            logger.exception("DuplicateDetector failed for rich nodes")
            return nodes, same_doc_groups

        merged_nodes, auto_groups, suggestions = self._split_and_apply(nodes, dup_groups)
        return merged_nodes, same_doc_groups + label_groups + attr_groups + auto_groups + suggestions

    def _split_and_apply(
        self,
        nodes: list[dict[str, Any]],
        dup_groups: list[Any],
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
        """Split DuplicateDetector groups into auto-merges vs. suggestions."""
        node_map = {n["id"]: n for n in nodes}
        consumed: set[str] = set()
        auto_groups: list[dict[str, Any]] = []
        suggestions: list[dict[str, Any]] = []
        merged_nodes: list[dict[str, Any]] = []

        for group in dup_groups:
            confidence = float(getattr(group, "confidence", 0.0))
            entity_ids = self._group_ids(group)
            entity_ids = [eid for eid in entity_ids if eid in node_map and eid not in consumed]
            if len(entity_ids) < 2:
                continue
            members = [node_map[eid] for eid in entity_ids]

            if confidence >= AUTO_MERGE_CONFIDENCE:
                members.sort(key=lambda n: len(n.get("attributes", [])), reverse=True)
                canonical = members[0]
                for fragment in members[1:]:
                    canonical = merge_node_pair(canonical, fragment)
                    consumed.add(fragment["id"])
                consumed.add(canonical["id"])
                merged_nodes.append(canonical)
                auto_groups.append({
                    "canonicalNodeId": canonical["id"],
                    "mergedNodeIds": [m["id"] for m in members[1:]],
                    "reason": f"Merged automatically (confidence {confidence:.2f})",
                })
            else:
                suggestions.append({
                    "canonicalNodeId": entity_ids[0],
                    "mergedNodeIds": entity_ids[1:],
                    "reason": f"Possible duplicate (confidence {confidence:.2f}) — review before merging",
                })

        merged_nodes.extend(n for n in nodes if n["id"] not in consumed)
        return merged_nodes, auto_groups, suggestions

    # ── shared-identifier merge ──────────────────────────────────────────────

    def _merge_by_shared_attribute(
        self, nodes: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Merge nodes that share the same value for the same attribute key,
        when that value looks like a unique identifier (contains both letters
        and a special char/digit, length ≥ 5). Handles cases where one
        extraction picks up an ID as the node label instead of the entity name.
        """
        # Build index: (attr_key, normalized_value) → first node_id that had it
        attr_index: dict[tuple[str, str], str] = {}
        # Map node_id → canonical_id (for merging)
        canonical_map: dict[str, str] = {n["id"]: n["id"] for n in nodes}
        node_map: dict[str, dict[str, Any]] = {n["id"]: n for n in nodes}

        def find(nid: str) -> str:
            while canonical_map[nid] != nid:
                canonical_map[nid] = canonical_map[canonical_map[nid]]
                nid = canonical_map[nid]
            return nid

        for node in nodes:
            for attr in node.get("attributes", []):
                key = attr.get("key", "")
                val = normalize_for_match(str(attr.get("value", "")))
                if not key or not _IDENTIFIER_RE.match(val):
                    continue
                index_key = (key, val)
                if index_key in attr_index:
                    # Union the two nodes
                    a, b = find(attr_index[index_key]), find(node["id"])
                    if a != b:
                        canonical_map[b] = a
                else:
                    attr_index[index_key] = node["id"]

        # Apply merges
        clusters: dict[str, list[dict[str, Any]]] = {}
        for node in nodes:
            root = find(node["id"])
            clusters.setdefault(root, []).append(node)

        merged_nodes: list[dict[str, Any]] = []
        groups: list[dict[str, Any]] = []
        for root, members in clusters.items():
            if len(members) == 1:
                merged_nodes.append(members[0])
                continue
            members.sort(key=lambda n: len(n.get("attributes", [])), reverse=True)
            canonical = members[0]
            for fragment in members[1:]:
                canonical = merge_node_pair(canonical, fragment)
            merged_nodes.append(canonical)
            groups.append({
                "canonicalNodeId": canonical["id"],
                "mergedNodeIds": [m["id"] for m in members[1:]],
                "reason": "Merged automatically: shared unique attribute value",
            })
            logger.info(
                "Shared-attribute merge: %d nodes merged (shared attr in %s)",
                len(members), [k for k, _ in attr_index.items() if find(attr_index[(k[0], k[1])]) == find(root)][:3],
            )

        return merged_nodes, groups

    # ── exact-label merge ────────────────────────────────────────────────────

    def _merge_identical_label_nodes(
        self, nodes: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Merge rich nodes that share the exact same normalized label.

        Nodes with the same name across different source documents represent the
        same entity.  Semantica DuplicateDetector may undercount confidence for
        well-known names; this step catches them unconditionally.
        """
        clusters: dict[str, list[dict[str, Any]]] = {}
        no_label: list[dict[str, Any]] = []
        for node in nodes:
            label = normalize_for_match(node.get("label") or "")
            if not label:
                no_label.append(node)
            else:
                clusters.setdefault(label, []).append(node)

        merged_nodes: list[dict[str, Any]] = []
        groups: list[dict[str, Any]] = []
        for label, members in clusters.items():
            if len(members) == 1:
                merged_nodes.append(members[0])
                continue
            members.sort(key=lambda n: len(n.get("attributes", [])), reverse=True)
            canonical = members[0]
            for fragment in members[1:]:
                canonical = merge_node_pair(canonical, fragment)
            merged_nodes.append(canonical)
            groups.append({
                "canonicalNodeId": canonical["id"],
                "mergedNodeIds": [m["id"] for m in members[1:]],
                "reason": f"Merged automatically: identical label '{label}'",
            })
            logger.info(
                "Identical-label merge: label=%r merged %d fragments into 1",
                label, len(members),
            )

        merged_nodes.extend(no_label)
        return merged_nodes, groups

    # ── same-document merge (no Semantica equivalent) ────────────────────────

    def _merge_same_document_nodes(
        self, nodes: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Merge extraction fragments that share a source document.

        A rich concept has at most one instance per source document. When the
        same document is bound via multiple bindings, each search call produces
        a partial node. This step merges those fragments unconditionally.
        """
        clusters: dict[str, list[dict[str, Any]]] = {}
        for node in nodes:
            for doc_id in node.get("_sourceDocumentIds") or []:
                clusters.setdefault(doc_id, []).append(node)
        no_doc = [n for n in nodes if not (n.get("_sourceDocumentIds") or [])]

        merged_nodes: list[dict[str, Any]] = []
        groups: list[dict[str, Any]] = []
        seen: set[str] = set()

        for doc_id, members in clusters.items():
            members = [m for m in members if m["id"] not in seen]
            if not members:
                continue
            if len(members) == 1:
                merged_nodes.append(members[0])
                seen.add(members[0]["id"])
                continue
            # Prefer the shortest label (most likely the entity name, not a resume excerpt).
            members.sort(key=lambda n: len(str(n.get("label") or "")))
            canonical = members[0]
            for fragment in members[1:]:
                canonical = merge_node_pair(canonical, fragment)
                seen.add(fragment["id"])
            seen.add(canonical["id"])
            merged_nodes.append(canonical)
            groups.append({
                "canonicalNodeId": canonical["id"],
                "mergedNodeIds": [m["id"] for m in members[1:]],
                "reason": f"Merged automatically: same source document ({doc_id})",
            })

        merged_nodes.extend(n for n in no_doc if n["id"] not in seen)
        return merged_nodes, groups

    # ── helpers ──────────────────────────────────────────────────────────────

    def _apply_groups(
        self,
        nodes: list[dict[str, Any]],
        dup_groups: list[Any],
        *,
        auto: bool,
        reason: str,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        node_map = {n["id"]: n for n in nodes}
        consumed: set[str] = set()
        merged_nodes: list[dict[str, Any]] = []
        merge_records: list[dict[str, Any]] = []

        for group in dup_groups:
            entity_ids = [eid for eid in self._group_ids(group) if eid in node_map and eid not in consumed]
            if len(entity_ids) < 2:
                continue
            members = [node_map[eid] for eid in entity_ids]
            members.sort(key=lambda n: len(n.get("attributes", [])), reverse=True)
            canonical = members[0]
            for fragment in members[1:]:
                canonical = merge_node_pair(canonical, fragment)
                consumed.add(fragment["id"])
            consumed.add(canonical["id"])
            merged_nodes.append(canonical)
            merge_records.append({
                "canonicalNodeId": canonical["id"],
                "mergedNodeIds": [m["id"] for m in members[1:]],
                "reason": reason,
            })

        merged_nodes.extend(n for n in nodes if n["id"] not in consumed)
        return merged_nodes, merge_records

    @staticmethod
    def _group_ids(group: Any) -> list[str]:
        ids = []
        for entity in getattr(group, "entities", None) or []:
            eid = getattr(entity, "id", None) or (entity.get("id") if isinstance(entity, dict) else None)
            if eid:
                ids.append(str(eid))
        return ids

    @staticmethod
    def _catalog_type_ids(graph: dict[str, Any]) -> set[str]:
        return {
            nt["id"]
            for nt in graph.get("nodes", [])
            if isinstance(nt, dict) and nt.get("id") and len(nt.get("attributes") or []) <= 1
        }
