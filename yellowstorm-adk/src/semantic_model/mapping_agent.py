"""Semantic model mapping orchestration."""

from __future__ import annotations

from typing import Any

from src.config.settings import get_settings

from .edge_detector import EdgeDetector
from .node_extractor import NodeExtractor
from .node_resolver import NodeResolver
from .utils import normalize_for_match, strip_provenance


class SemanticModelMappingAgent:
    def __init__(self) -> None:
        self._extractor = NodeExtractor()
        self._resolver = NodeResolver()
        self._edge_detector = EdgeDetector()

    def generate(self, request: dict[str, Any]) -> dict[str, Any]:
        graph = self._required_object(request, "graphDesignerCanvas")
        search_tasks = self._required_list(request, "searchTasks")
        existing_entities: list[dict[str, Any]] = request.get("existingEntities") or []
        manual_instances = request.get("manualInstances") or []
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
        manual_targets = self._manual_instance_targets(graph, manual_instances)

        raw_nodes = self._extractor.extract(
            graph, search_tasks, llm, normalize_text,
            concurrency=concurrency, batch_size=batch_size,
        )

        # A manual directive is an allow-list for its concept only. Other
        # concepts and the extraction/search pipeline remain unchanged.
        if manual_targets:
            raw_nodes = [
                node for node in raw_nodes
                if node.get("nodeTypeId") not in manual_targets
                or any(
                    self._labels_match(node.get("label"), requested)
                    for requested in manual_targets[node["nodeTypeId"]]
                )
            ]
            for node in self._manual_instance_nodes(graph, manual_instances):
                already_extracted = any(
                    str(existing.get("nodeTypeId")) == str(node["nodeTypeId"])
                    and self._labels_match(existing.get("label"), node.get("label"))
                    for existing in raw_nodes
                )
                if not already_extracted:
                    raw_nodes.append(node)

        resolved_nodes, merge_groups = self._resolver.resolve(
            raw_nodes, graph, concurrency=concurrency
        )
        edges = self._edge_detector.detect(
            graph, resolved_nodes, search_tasks, normalize_text, settings
        )
        edges.extend(self._manual_instance_edges(graph, resolved_nodes, manual_instances, edges))
        nodes_with_keys = self._resolve_entity_keys(resolved_nodes, existing_entities)

        return {
            "nodes": strip_provenance(nodes_with_keys),
            "edges": edges,
            "mergeGroups": merge_groups,
        }

    @staticmethod
    def _manual_instance_targets(
        graph: dict[str, Any], manual_instances: list[dict[str, Any]]
    ) -> dict[str, set[str]]:
        """Group explicitly selected labels by configured node type ID."""
        targets: dict[str, set[str]] = {}
        for node in SemanticModelMappingAgent._manual_instance_nodes(graph, manual_instances):
            targets.setdefault(str(node["nodeTypeId"]), set()).add(
                normalize_for_match(node["label"])
            )
        return targets

    @staticmethod
    def _manual_instance_nodes(
        graph: dict[str, Any], manual_instances: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Create records for explicit labels not found in source documents."""
        valid_type_ids = {
            str(node.get("id"))
            for node in graph.get("nodes", [])
            if isinstance(node, dict)
            and node.get("id")
            and node.get("recordPolicy") != "none"
        }
        result: list[dict[str, Any]] = []
        for directive in manual_instances:
            if not isinstance(directive, dict):
                continue
            node_type_id = directive.get("nodeTypeId")
            labels = directive.get("labels")
            if node_type_id not in valid_type_ids or not isinstance(labels, list):
                continue
            for label in labels:
                if not isinstance(label, str) or not label.strip():
                    continue
                result.append({
                    "id": f"manual-{node_type_id}-{len(result)}",
                    "nodeTypeId": node_type_id,
                    "label": label.strip(),
                    "attributes": [],
                    "evidenceReferences": [],
                    "confidence": 1.0,
                    "_sourceDocumentIds": [],
                    "_fileName": "",
                })
        return result

    @staticmethod
    def _labels_match(left: Any, right: Any) -> bool:
        """Match a manual label exactly after harmless text normalization."""
        normalized_left = normalize_for_match(left)
        normalized_right = normalize_for_match(right)
        return bool(normalized_left and normalized_left == normalized_right)

    @classmethod
    def _manual_instance_edges(
        cls,
        graph: dict[str, Any],
        nodes: list[dict[str, Any]],
        manual_instances: list[dict[str, Any]],
        existing_edges: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Link selected instances to sourced entities using provenance, not labels."""
        targets = cls._manual_instance_targets(graph, manual_instances)
        if not targets:
            return []

        selected = [
            node for node in nodes
            if str(node.get("nodeTypeId")) in targets
            and any(
                cls._labels_match(node.get("label"), label)
                for label in targets[str(node.get("nodeTypeId"))]
            )
        ]
        sourced = [
            node for node in nodes
            if node.get("_sourceDocumentIds") or node.get("evidenceReferences")
        ]
        relation_types = [
            relation for relation in graph.get("relations", [])
            if isinstance(relation, dict)
            and relation.get("id")
            and relation.get("sourceNodeTypeId")
            and relation.get("targetNodeTypeId")
        ]
        existing_keys = {
            (edge.get("relationTypeId"), edge.get("sourceNodeId"), edge.get("targetNodeId"))
            for edge in existing_edges
        }
        result: list[dict[str, Any]] = []
        for manual in selected:
            for document in sourced:
                if manual["id"] == document["id"]:
                    continue
                manual_provenance = set(manual.get("_sourceDocumentIds") or []) | set(
                    manual.get("evidenceReferences") or []
                )
                document_provenance = set(document.get("_sourceDocumentIds") or []) | set(
                    document.get("evidenceReferences") or []
                )
                if not manual_provenance or not manual_provenance.intersection(document_provenance):
                    continue
                for relation in relation_types:
                    source_type = relation["sourceNodeTypeId"]
                    target_type = relation["targetNodeTypeId"]
                    if {source_type, target_type} != {
                        manual.get("nodeTypeId"), document.get("nodeTypeId")
                    }:
                        continue
                    source_id, target_id = (
                        (document["id"], manual["id"])
                        if source_type == document.get("nodeTypeId")
                        else (manual["id"], document["id"])
                    )
                    key = (relation["id"], source_id, target_id)
                    if key in existing_keys:
                        continue
                    result.append({
                        "id": f"manual-edge-{len(result)}",
                        "relationTypeId": relation["id"],
                        "sourceNodeId": source_id,
                        "targetNodeId": target_id,
                        "evidenceReferences": list(document.get("evidenceReferences") or []),
                        "confidence": 0.9,
                    })
                    existing_keys.add(key)
        return result

    def _resolve_entity_keys(
        self,
        nodes: list[dict[str, Any]],
        existing_entities: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Assign stable entity keys by identifiers, then normalized labels."""
        if not existing_entities:
            return [dict(node, entityKey=None) for node in nodes]

        label_index: dict[tuple[str, str], str] = {}
        attr_index: dict[tuple[str, str, str], str] = {}
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
                value = normalize_for_match(str(attr.get("value", "")))
                if key and value and len(value) >= 3:
                    attr_index.setdefault((node_type_id, key, value), entity_key)

        result: list[dict[str, Any]] = []
        for node in nodes:
            node_type_id = node.get("nodeTypeId", "")
            matched_key: str | None = None
            for attr in node.get("attributes") or []:
                key = attr.get("key", "")
                value = normalize_for_match(str(attr.get("value", "")))
                if key and value:
                    matched_key = attr_index.get((node_type_id, key, value))
                    if matched_key:
                        break
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
