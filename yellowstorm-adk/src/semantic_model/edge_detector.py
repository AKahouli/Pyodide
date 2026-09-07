"""Stage 3 — Edge detection with Semantica's NERExtractor + RelationExtractor."""

from __future__ import annotations

import concurrent.futures
import logging
import uuid
from typing import Any

from .utils import normalize_for_match, word_variants

logger = logging.getLogger(__name__)


class EdgeDetector:
    """Detect instance edges using Semantica's NER + RelationExtractor."""

    def detect(
        self,
        graph: dict[str, Any],
        resolved_nodes: list[dict[str, Any]],
        search_tasks: list[dict[str, Any]],
        normalize_text: Any,
        settings: Any,
    ) -> list[dict[str, Any]]:
        relation_types = [
            r for r in graph.get("relations", [])
            if isinstance(r, dict) and r.get("id")
        ]
        if not relation_types or len(resolved_nodes) < 2:
            logger.info(
                "Edge detection skipped: relation_types=%d resolved_nodes=%d",
                len(relation_types), len(resolved_nodes),
            )
            return []

        try:
            from semantica.semantic_extract import NERExtractor, RelationExtractor
        except ImportError:
            logger.warning("semantica.semantic_extract not available — skipping edge detection")
            return []

        documents = self._evidence_documents(search_tasks, normalize_text)
        if not documents:
            return []
        logger.info(
            "Edge detection: %d blobs, %d nodes, %d relation types",
            len(documents), len(resolved_nodes), len(relation_types),
        )

        type_id_to_label = {
            nt["id"]: nt.get("label", nt["id"])
            for nt in graph.get("nodes", [])
            if isinstance(nt, dict) and nt.get("id")
        }
        entity_types = list(
            {type_id_to_label.get(n.get("nodeTypeId", ""), "") for n in resolved_nodes} - {""}
        )

        ner = NERExtractor(
            method=["llm"],
            entity_types=entity_types,
            provider="openai",
            api_key=settings.LITELLM_API_SECRET_KEY,
            base_url=settings.LITELLM_API_BASE_URL,
            llm_model=settings.SEMANTIC_MODEL_ONTOLOGY_MODEL,
        )
        extractor = RelationExtractor(
            method=["llm"],
            provider="openai",
            api_key=settings.LITELLM_API_SECRET_KEY,
            base_url=settings.LITELLM_API_BASE_URL,
            llm_model=settings.SEMANTIC_MODEL_ONTOLOGY_MODEL,
            relation_types=[
                str(r.get("label") or r.get("key") or "") for r in relation_types
            ],
            confidence_threshold=0.3,
            bidirectional=True,
        )

        node_label_index = self._build_label_index(resolved_nodes)
        pair_scores: dict[tuple[str, str, str], float] = {}

        # Each document blob is independent → process them in parallel.
        # Each blob = 1 NER call + 1 RelationExtractor call, so parallelizing
        # divides the wall time by min(num_blobs, concurrency).
        concurrency = max(1, min(
            getattr(settings, "SEMANTIC_MODEL_EXTRACTION_CONCURRENCY", 8),
            len(documents),
        ))
        with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = [
                pool.submit(
                    self._process_document_blob,
                    ner, extractor, text, node_label_index,
                    relation_types, resolved_nodes, type_id_to_label,
                )
                for text in documents
            ]
            for future in concurrent.futures.as_completed(futures):
                try:
                    doc_pair_scores = future.result()
                    for key, score in doc_pair_scores.items():
                        pair_scores[key] = max(pair_scores.get(key, 0.0), score)
                except Exception:
                    logger.exception("Edge detection document blob failed")

        logger.info("LLM edges: %d", len(pair_scores))

        return [
            {
                "id": f"edge-{uuid.uuid4()}",
                "relationTypeId": rel_id,
                "sourceNodeId": src_id,
                "targetNodeId": tgt_id,
                "evidenceReferences": [],
                "confidence": round(conf, 2),
            }
            for (rel_id, src_id, tgt_id), conf in pair_scores.items()
        ]

    # ── helpers ──────────────────────────────────────────────────────────────

    def _process_document_blob(
        self,
        ner: Any,
        extractor: Any,
        text: str,
        node_label_index: dict[str, dict[str, Any]],
        relation_types: list[dict[str, Any]],
        resolved_nodes: list[dict[str, Any]],
        type_id_to_label: dict[str, str],
    ) -> dict[tuple[str, str, str], float]:
        """Run NER + RelationExtractor on one document blob. Called from a thread pool."""
        try:
            raw_entities = ner.extract_entities(text) or []
        except Exception:
            logger.exception("NERExtractor failed")
            return {}

        entities, seen_ids = [], set()
        for entity in raw_entities:
            entity_text = normalize_for_match(
                getattr(entity, "text", None) or getattr(entity, "name", None) or ""
            )
            matched = node_label_index.get(entity_text)
            if not matched or matched["id"] in seen_ids:
                continue
            seen_ids.add(matched["id"])
            node_type_id = str(matched.get("nodeTypeId", ""))
            entity.label = type_id_to_label.get(node_type_id, node_type_id)
            if not isinstance(getattr(entity, "metadata", None), dict):
                entity.metadata = {}
            entity.metadata["nodeId"] = matched["id"]
            entities.append(entity)

        logger.info("NER: %d raw → %d matched", len(raw_entities), len(seen_ids))
        if len(seen_ids) < 2:
            return {}

        try:
            relations = extractor.extract_relations(text, entities) or []
        except Exception:
            logger.exception("RelationExtractor failed")
            return {}

        node_types_map = {n["id"]: n.get("nodeTypeId") for n in resolved_nodes}
        pair_scores: dict[tuple[str, str, str], float] = {}
        skipped_resolution = 0
        skipped_type_match = 0
        logger.info("RelationExtractor: %d relations", len(relations))
        for rel in relations:
            subj_text = getattr(rel.subject, "text", None) or getattr(rel.subject, "name", None) or ""
            obj_text = getattr(rel.object, "text", None) or getattr(rel.object, "name", None) or ""
            src_id = self._resolve_entity_id(rel.subject, node_label_index)
            tgt_id = self._resolve_entity_id(rel.object, node_label_index)
            if not src_id or not tgt_id or src_id == tgt_id:
                logger.info(
                    "relation skipped entity_resolution: subject=%r src_id=%s object=%r tgt_id=%s",
                    subj_text, src_id, obj_text, tgt_id,
                )
                skipped_resolution += 1
                continue
            matched_rel = self._match_relation_type(relation_types, resolved_nodes, src_id, tgt_id)
            if not matched_rel:
                logger.info(
                    "relation skipped no_type_match: subject=%r src_type=%s object=%r tgt_type=%s",
                    subj_text, node_types_map.get(src_id), obj_text, node_types_map.get(tgt_id),
                )
                skipped_type_match += 1
                continue
            rel_id, ordered_src, ordered_tgt = matched_rel
            key = (rel_id, ordered_src, ordered_tgt)
            pair_scores[key] = max(pair_scores.get(key, 0.0), float(getattr(rel, "confidence", 0.0)))
        if skipped_resolution or skipped_type_match:
            logger.info(
                "Relations skipped: entity_resolution=%d no_type_match=%d",
                skipped_resolution, skipped_type_match,
            )
        return pair_scores

    @staticmethod
    def _build_label_index(resolved_nodes: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        index: dict[str, dict[str, Any]] = {}
        for node in resolved_nodes:
            label = (node.get("label") or "").strip()
            if not label:
                continue
            for variant in word_variants(label):
                key = normalize_for_match(variant)
                if key and key not in index:
                    index[key] = node
        return index

    @staticmethod
    def _resolve_entity_id(entity: Any, label_index: dict[str, dict[str, Any]]) -> str | None:
        node_id = (getattr(entity, "metadata", None) or {}).get("nodeId")
        if node_id:
            return node_id
        text = normalize_for_match(
            getattr(entity, "text", None) or getattr(entity, "name", None) or ""
        )
        matched = label_index.get(text)
        return matched["id"] if matched else None

    @staticmethod
    def _match_relation_type(
        relation_types: list[dict[str, Any]],
        resolved_nodes: list[dict[str, Any]],
        source_id: str,
        target_id: str,
    ) -> tuple[str, str, str] | None:
        node_types = {n["id"]: n.get("nodeTypeId") for n in resolved_nodes}
        for rel in relation_types:
            src_type = rel.get("sourceNodeTypeId")
            tgt_type = rel.get("targetNodeTypeId")
            if node_types.get(source_id) == src_type and node_types.get(target_id) == tgt_type:
                return rel["id"], source_id, target_id
            if node_types.get(target_id) == src_type and node_types.get(source_id) == tgt_type:
                return rel["id"], target_id, source_id
        return None

    @staticmethod
    def _evidence_documents(search_tasks: list[dict[str, Any]], normalize_text: Any) -> list[str]:
        """One text blob per workspace — groups evidence for cross-document NER."""
        per_workspace: dict[str, list[str]] = {}
        for task in search_tasks:
            key = task.get("workspaceId") or task.get("sourceDocumentId") or task.get("fileName") or ""
            for item in task.get("evidence", []):
                if not isinstance(item, dict):
                    continue
                quote = str(item.get("quote", "")).strip()
                if quote:
                    per_workspace.setdefault(key, []).append(normalize_text(quote))
        return ["\n".join(quotes) for quotes in per_workspace.values() if quotes]
