"""Semantic model mapping — thin orchestrator.

Three-stage pipeline, each stage in its own module:
  1. node_extractor  — LLM attribute extraction per (node_type, document)
  2. node_resolver   — Semantica DuplicateDetector dedup + same-doc merge
  3. edge_detector   — Semantica NERExtractor + RelationExtractor + co-occurrence
"""

from __future__ import annotations

from typing import Any

from src.config.settings import get_settings

from .edge_detector import EdgeDetector
from .node_extractor import NodeExtractor
from .node_resolver import NodeResolver
from .utils import strip_provenance


class SemanticModelMappingAgent:

    def __init__(self) -> None:
        self._extractor = NodeExtractor()
        self._resolver = NodeResolver()
        self._edge_detector = EdgeDetector()

    def generate(self, request: dict[str, Any]) -> dict[str, Any]:
        graph = self._required_object(request, "graphDesignerCanvas")
        search_tasks = self._required_list(request, "searchTasks")
        existing_entities: list[dict[str, Any]] = request.get("existingEntities") or []
        settings = get_settings()
        normalize_text, LiteLLM = self._dependencies()

        llm_kwargs: dict[str, Any] = {
            "model": settings.SEMANTIC_MODEL_ONTOLOGY_MODEL,
            "api_key": settings.LITELLM_API_SECRET_KEY,
            "api_base": settings.LITELLM_API_BASE_URL,
            "timeout": settings.SEMANTIC_MODEL_LLM_TIMEOUT_SECONDS,
        }
        max_tokens = getattr(settings, "SEMANTIC_MODEL_LLM_MAX_TOKENS", 0)
        if max_tokens and max_tokens > 0:
            llm_kwargs["max_tokens"] = max_tokens
        llm = LiteLLM(**llm_kwargs)

        concurrency = settings.SEMANTIC_MODEL_EXTRACTION_CONCURRENCY
        batch_size = settings.SEMANTIC_MODEL_EXTRACTION_BATCH_SIZE

        # Stage 1 — extract raw nodes. Batches multiple concepts per LLM call per doc
        # to reduce total call count from N×M (concepts × docs) to ~M×ceil(N/batch_size).
        raw_nodes = self._extractor.extract(
            graph, search_tasks, llm, normalize_text,
            concurrency=concurrency, batch_size=batch_size,
        )

        # Stage 2 — resolve: dedup + merge with Semantica DuplicateDetector (parallel per concept type)
        resolved_nodes, merge_groups = self._resolver.resolve(raw_nodes, graph, concurrency=concurrency)

        # Stage 3 — detect edges with Semantica NER + RelationExtractor
        edges = self._edge_detector.detect(
            graph, resolved_nodes, search_tasks, normalize_text, settings
        )

        # Stage 4 — match resolved nodes against existing graph entities and assign stable entityKey.
        # entityKey = existing record UUID → backend will UPDATE; None → backend will CREATE.
        nodes_with_keys = self._resolve_entity_keys(resolved_nodes, existing_entities)

        return {
            "nodes": strip_provenance(nodes_with_keys),
            "edges": edges,
            "mergeGroups": merge_groups,
        }

    def _resolve_entity_keys(
        self,
        nodes: list[dict[str, Any]],
        existing_entities: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Set entityKey on every resolved node.

        For nodes that match a known graph entity the entityKey is the stable
        UUID stored in values._entity_key (or the record id for legacy records).
        For new entities entityKey is None — the backend will create the record
        and store a fresh _entity_key on it.

        Matching strategy (ordered by reliability):
        1. Shared identifier-like attribute (same key + normalised value, same nodeTypeId)
        2. Normalised label within same nodeTypeId
        """
        from .utils import normalize_for_match

        if not existing_entities:
            return [dict(node, entityKey=None) for node in nodes]

        # Build lookup indices keyed by nodeTypeId
        label_index: dict[tuple[str, str], str] = {}        # (nodeTypeId, norm_label) → entityKey
        attr_index: dict[tuple[str, str, str], str] = {}    # (nodeTypeId, attr_key, norm_value) → entityKey

        for entity in existing_entities:
            entity_key = entity.get("entityKey")
            node_type_id = entity.get("nodeTypeId", "")
            if not entity_key or not node_type_id:
                continue

            label = normalize_for_match(entity.get("label") or "")
            if label:
                label_index.setdefault((node_type_id, label), entity_key)

            for attr in entity.get("attributes") or []:
                key = attr.get("key", "")
                val = normalize_for_match(str(attr.get("value", "")))
                if key and val and len(val) >= 3:
                    attr_index.setdefault((node_type_id, key, val), entity_key)

        result: list[dict[str, Any]] = []
        for node in nodes:
            node_type_id = node.get("nodeTypeId", "")
            matched_key: str | None = None

            # Strategy 1 — shared identifier-like attribute value
            for attr in node.get("attributes") or []:
                key = attr.get("key", "")
                val = normalize_for_match(str(attr.get("value", "")))
                if key and val:
                    found = attr_index.get((node_type_id, key, val))
                    if found:
                        matched_key = found
                        break

            # Strategy 2 — normalised label
            if not matched_key:
                label = normalize_for_match(node.get("label") or "")
                if label:
                    matched_key = label_index.get((node_type_id, label))

            result.append(dict(node, entityKey=matched_key))

        return result

    @staticmethod
    def _dependencies() -> tuple[Any, Any]:
        try:
            from semantica.llms import LiteLLM
            from semantica.normalize import normalize_text
        except ImportError as error:
            raise RuntimeError("Semantica is required for semantic mapping") from error
        return normalize_text, LiteLLM

    @staticmethod
    def _required_object(request: dict[str, Any], key: str) -> dict[str, Any]:
        value = request.get(key)
        if not isinstance(value, dict):
            raise ValueError(f"{key} must be an object")
        return value

    @staticmethod
    def _required_list(request: dict[str, Any], key: str) -> list[dict[str, Any]]:
        value = request.get(key)
        if not isinstance(value, list) or not all(isinstance(i, dict) for i in value):
            raise ValueError(f"{key} must be a list of objects")
        return value
