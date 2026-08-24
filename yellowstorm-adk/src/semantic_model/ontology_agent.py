"""Generate a formal ontology from the existing Semantic Model Designer canvas."""

from __future__ import annotations

import json
import re
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from src.config.settings import get_settings


class SemanticModelOntologyAgent:
    """Python-only semantic generation boundary for the Semantic Model feature.

    Semantica owns ontology generation and OWL serialization. This agent only
    supplies the user-approved requirements and the existing graph-designer
    canvas as generation context.
    """

    def generate(self, request: dict[str, Any]) -> dict[str, Any]:
        business_requirements = self._required_list(request, "businessRequirements")
        graph_designer_canvas = self._required_object(request, "graphDesignerCanvas")
        LLMOntologyGenerator, OntologyEngine, LiteLLM = self._semantica_classes()
        settings = get_settings()
        ontology_name = self._ontology_name(graph_designer_canvas)
        namespace = self._namespace(graph_designer_canvas, ontology_name)

        # The factual context comes from Yellowstorm. The ontology prompt and
        # normalization come from Semantica's LLMOntologyGenerator.
        generator = LLMOntologyGenerator(provider="")
        prompt = generator._build_prompt(
            text=self._generation_context(business_requirements, graph_designer_canvas),
            name=ontology_name,
            base_uri=namespace,
        )
        result = LiteLLM(
            model=settings.SEMANTIC_MODEL_ONTOLOGY_MODEL,
            api_key=settings.LITELLM_API_SECRET_KEY,
            api_base=settings.LITELLM_API_BASE_URL,
        ).generate_structured(prompt)
        ontology = generator._normalize_output(
            result,
            name=ontology_name,
            base_uri=namespace,
            version="1.0",
        )
        ontology = self._align_with_designer_canvas(ontology, graph_designer_canvas, namespace)
        with TemporaryDirectory() as temporary_directory:
            owl_path = Path(temporary_directory) / "ontology.ttl"
            OntologyEngine(base_uri=namespace).export_owl(ontology, str(owl_path), format="turtle")
            owl_turtle = owl_path.read_text(encoding="utf-8")

        return {
            "ontologyDefinition": ontology,
            "ontologyTtl": owl_turtle,
        }

    @staticmethod
    def _semantica_classes() -> tuple[Any, Any, Any]:
        try:
            from semantica.ontology import LLMOntologyGenerator, OntologyEngine
            from semantica.llms import LiteLLM
        except ImportError as error:
            raise RuntimeError(
                "Semantica is required by SemanticModelOntologyAgent. Install the yellowstorm-adk requirements first."
            ) from error
        return LLMOntologyGenerator, OntologyEngine, LiteLLM

    @staticmethod
    def _required_list(request: dict[str, Any], key: str) -> list[dict[str, Any]]:
        value = request.get(key)
        if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
            raise ValueError(f"{key} must be a list of objects")
        return value

    @staticmethod
    def _required_object(request: dict[str, Any], key: str) -> dict[str, Any]:
        value = request.get(key)
        if not isinstance(value, dict):
            raise ValueError(f"{key} must be an object")
        return value

    @staticmethod
    def _namespace(canvas: dict[str, Any], ontology_name: str) -> str:
        value = canvas.get("namespace")
        if isinstance(value, str) and value.strip():
            return value.strip().rstrip("/#") + "/"
        slug = re.sub(r"[^a-z0-9]+", "-", ontology_name.lower()).strip("-") or "semantic-model"
        return f"https://yellowstorm.ai/ontology/{slug}/"

    @staticmethod
    def _ontology_name(canvas: dict[str, Any]) -> str:
        value = canvas.get("name")
        return value.strip() if isinstance(value, str) and value.strip() else "SemanticModelOntology"

    @staticmethod
    def _align_with_designer_canvas(
        ontology: dict[str, Any],
        canvas: dict[str, Any],
        namespace: str,
    ) -> dict[str, Any]:
        """Keep the formal schema aligned with the saved Graph Designer structure."""
        nodes = canvas.get("nodes")
        relations = canvas.get("relations")
        if not isinstance(nodes, list) or not isinstance(relations, list):
            return ontology

        generated_classes = {
            str(item.get("name") or item.get("label") or "").casefold(): item
            for item in ontology.get("classes", [])
            if isinstance(item, dict)
        }
        generated_properties = {
            str(item.get("name") or item.get("label") or "").casefold(): item
            for item in ontology.get("properties", [])
            if isinstance(item, dict)
        }
        node_labels: dict[str, str] = {}
        classes: list[dict[str, Any]] = []
        for node in nodes:
            if not isinstance(node, dict):
                continue
            node_id = node.get("id")
            label = node.get("label")
            if not isinstance(node_id, str) or not isinstance(label, str) or not label.strip():
                continue
            label = label.strip()
            node_labels[node_id] = label
            generated = generated_classes.get(label.casefold(), {})
            description = node.get("description")
            classes.append(
                {
                    "name": label,
                    "label": label,
                    "comment": description.strip()
                    if isinstance(description, str) and description.strip()
                    else generated.get("comment"),
                    "parent": generated.get("parent"),
                }
            )

        properties: list[dict[str, Any]] = []
        property_names: set[str] = set()
        for node in nodes:
            if not isinstance(node, dict):
                continue
            node_id = node.get("id")
            domain = node_labels.get(node_id)
            if not domain:
                continue
            attributes = node.get("attributes")
            if not isinstance(attributes, list):
                continue
            node_key = node.get("key")
            for attribute in attributes:
                if not isinstance(attribute, dict):
                    continue
                key = attribute.get("key")
                if not isinstance(key, str) or not key.strip():
                    continue
                property_name = key.strip()
                if property_name.casefold() in property_names:
                    prefix = node_key.strip() if isinstance(node_key, str) and node_key.strip() else domain
                    property_name = f"{prefix}_{property_name}"
                property_names.add(property_name.casefold())
                attribute_type = attribute.get("type")
                properties.append(
                    {
                        "name": property_name,
                        "label": attribute.get("label") or key.strip(),
                        "comment": attribute.get("description"),
                        "type": "data",
                        "domain": [domain],
                        "range": SemanticModelOntologyAgent._designer_attribute_range(attribute_type),
                        "required": attribute.get("required") is True,
                        "one_of": attribute.get("options", []) if attribute_type == "enum" else [],
                    }
                )

        for relation in relations:
            if not isinstance(relation, dict):
                continue
            source = node_labels.get(relation.get("sourceNodeTypeId"))
            target = node_labels.get(relation.get("targetNodeTypeId"))
            key = relation.get("key")
            label = relation.get("label")
            if not source or not target or not isinstance(key, str) or not key.strip():
                continue
            property_name = key.strip()
            if property_name.casefold() in property_names:
                property_name = f"relation_{property_name}"
            property_names.add(property_name.casefold())
            generated = generated_properties.get(key.casefold(), {})
            description = relation.get("description")
            properties.append(
                {
                    "name": property_name,
                    "label": label.strip() if isinstance(label, str) and label.strip() else property_name,
                    "comment": description.strip()
                    if isinstance(description, str) and description.strip()
                    else generated.get("comment"),
                    "type": "object",
                    "domain": [source],
                    "range": [target],
                }
            )

        if classes:
            ontology["classes"] = classes
        if properties:
            ontology["properties"] = properties
        ontology["uri"] = namespace
        return ontology

    @staticmethod
    def _designer_attribute_range(attribute_type: Any) -> str:
        """Map the existing designer types to Semantica's supported XSD ranges."""
        return {
            "number": "xsd:decimal",
            "boolean": "xsd:boolean",
            "date": "xsd:date",
        }.get(attribute_type, "xsd:string")

    @staticmethod
    def _generation_context(
        business_requirements: list[dict[str, Any]],
        graph_designer_canvas: dict[str, Any],
    ) -> str:
        """Pass contextual data to Semantica's native LLM ontology generator."""
        return "\n\n".join((
            "Business requirements:\n" + json.dumps(business_requirements, ensure_ascii=False),
            "Existing Semantic Model Designer canvas:\n" + json.dumps(graph_designer_canvas, ensure_ascii=False),
        ))
