"""Build a Semantica knowledge graph from an approved mapping plan.

Converts the reviewable mapping plan (instance nodes + edges) into Semantica's
entity/relationship shapes, runs semantica.kg.GraphBuilder, and exports the
result as graph JSON via semantica.export.JSONExporter for visualisation.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any


class SemanticModelGraphBuilder:
    """Semantica-native graph construction from a mapping plan."""

    def build(self, request: dict[str, Any]) -> dict[str, Any]:
        model_id = str(request.get("modelId") or "semantic-model")
        canvas = self._required_object(request, "graphDesignerCanvas")
        plan = self._required_object(request, "plan")
        GraphBuilder, JSONExporter = self._semantica_classes()

        node_type_labels = {
            node_type["id"]: node_type.get("label") or node_type.get("key") or node_type["id"]
            for node_type in canvas.get("nodes", [])
            if isinstance(node_type, dict) and node_type.get("id")
        }
        relation_type_labels = {
            relation["id"]: relation.get("label") or relation.get("key") or relation["id"]
            for relation in canvas.get("relations", [])
            if isinstance(relation, dict) and relation.get("id")
        }

        entities = [
            {
                "id": node["id"],
                "name": node.get("label") or node["id"],
                "type": node_type_labels.get(node.get("nodeTypeId"), node.get("nodeTypeId")),
                "properties": {
                    attribute["key"]: attribute["value"]
                    for attribute in node.get("attributes", [])
                    if isinstance(attribute, dict) and attribute.get("key")
                },
                "confidence": node.get("confidence", 0.0),
            }
            for node in plan.get("nodes", [])
            if isinstance(node, dict) and node.get("id")
        ]
        relationships = [
            {
                "source": edge["sourceNodeId"],
                "target": edge["targetNodeId"],
                "type": relation_type_labels.get(edge.get("relationTypeId"), edge.get("relationTypeId")),
                "confidence": edge.get("confidence", 0.0),
            }
            for edge in plan.get("edges", [])
            if isinstance(edge, dict) and edge.get("sourceNodeId") and edge.get("targetNodeId")
        ]

        builder = GraphBuilder(merge_entities=False, resolve_conflicts=False)
        knowledge_graph = builder.build(
            {"entities": entities, "relationships": relationships},
            extract=False,
        )
        if not isinstance(knowledge_graph, dict):
            raise ValueError("Semantica GraphBuilder returned an invalid graph")

        export_path = self._export_json(knowledge_graph, model_id, JSONExporter)
        return {"graph": knowledge_graph, "exportPath": export_path}

    @staticmethod
    def _export_json(knowledge_graph: dict[str, Any], model_id: str, exporter_cls: Any) -> str | None:
        """Write graph.json next to the service for quick dev visualisation."""
        try:
            output_directory = Path("graph_exports")
            output_directory.mkdir(exist_ok=True)
            output_path = output_directory / f"{model_id}.graph.json"
            exporter_cls(indent=2, ensure_ascii=False).export_knowledge_graph(
                knowledge_graph, str(output_path)
            )
            return str(output_path.resolve())
        except Exception:
            # Export to disk is best-effort; the graph is returned inline anyway.
            return None

    @staticmethod
    def _semantica_classes() -> tuple[Any, Any]:
        try:
            from semantica.export import JSONExporter
            from semantica.kg import GraphBuilder
        except ImportError as error:
            raise RuntimeError("Semantica is required for graph building") from error
        return GraphBuilder, JSONExporter

    @staticmethod
    def _required_object(request: dict[str, Any], key: str) -> dict[str, Any]:
        value = request.get(key)
        if not isinstance(value, dict):
            raise ValueError(f"{key} must be an object")
        return value
