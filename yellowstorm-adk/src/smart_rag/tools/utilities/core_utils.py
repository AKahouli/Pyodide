"""
Core Utilities Module

Contains core utility functions for tree building, schema generation, and data structure manipulation.
"""
import copy
from typing import Dict, Any, List, Tuple, Optional
from langchain.schema import Document

from src.logger.logging import get_logger

logger = get_logger("api.smart_rag.tools.core_utils")


def transform_id(node_id):
    """
    A sample transformation function.
    Modify this function to dynamically transform a node's ID as needed.
    """
    return f"{node_id}"


def assign_transformed_ids_and_extract_attributes(brain_tree, attribute_values, attribute_mapping):
    """
    Recursively traverse the brain tree to build an attribute mapping for specific attributes.
    In this version we process the 'name' attribute and the 'documents' list.

    Args:
        brain_tree (list): List representing the brain tree.
        attribute_values (dict): Dictionary to store unique attribute values.
        attribute_mapping (dict): Dictionary to map attribute values to transformed IDs.
    """
    for node in brain_tree:
        # Process the "name" attribute only.
        for key in ['name']:
            value = node.get(key)
            if value:
                transformed = transform_id(node['id'])
                attribute_mapping.setdefault(key, {}).setdefault(value, []).append(transformed)
                attribute_values.setdefault(key, set()).add(value)

        # Process attributes that are lists (e.g. 'documents').
        docs = node.get('documents')
        if docs:
            for doc in docs:
                transformed = transform_id(node['id'])
                attribute_mapping.setdefault('documents', {}).setdefault(doc, []).append(transformed)
                attribute_values.setdefault('documents', set()).add(doc)

        # Recurse into children if any exist.
        children = node.get('children', [])
        if children:
            assign_transformed_ids_and_extract_attributes(children, attribute_values, attribute_mapping)


def build_brain_tree(brain_relations):
    """
    Build a hierarchical tree from brain_relations, including all attributes.

    Args:
        brain_relations (dict): The brain_relations dictionary containing 'nodes' and 'relationships'.

    Returns:
        list: A list of root nodes, each with nested children.
    """
    if not brain_relations or not brain_relations.get("nodes"):
        return []

    # Step 1: Create a lookup dictionary for all nodes (brain instances)
    node_lookup = {node["id"]: {**node, "children": []} for node in brain_relations.get("nodes", [])}

    # Step 2: Identify parent-child relationships and build the tree
    child_ids = set()
    for relation in brain_relations.get('relationships', []):
        parent_id, child_id = relation.get("source"), relation.get("target")
        if parent_id in node_lookup and child_id in node_lookup:
            node_lookup[parent_id]["children"].append(node_lookup[child_id])
            child_ids.add(child_id)  # Track child nodes

    # Step 3: Find root nodes (brains that are never a child)
    root_nodes = [node for node_id, node in node_lookup.items() if node_id not in child_ids]

    return root_nodes


def generate_brain_tree_schema(brain_tree):
    """
    Generate schema for brain tree structure.
    
    Args:
        brain_tree: The brain tree structure
        
    Returns:
        Tuple of (schema, attribute_mapping, processed_tree)
    """
    if not brain_tree:
        return None, None, None

    attribute_values = {}
    attribute_mapping = {}
    
    # Extract attributes and build mappings
    assign_transformed_ids_and_extract_attributes(brain_tree, attribute_values, attribute_mapping)

    # Build the schema
    schema = {
        "name": "preform_all_brain_search",
        "strict": True,
        "description": "Search within specific brains/knowledge bases",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query"
                }
            },
            "required": ["query"],
            "additionalProperties": False
        }
    }

    # Add brain name properties if available
    if 'name' in attribute_values and attribute_values['name']:
        brain_names = list(attribute_values['name'])
        schema["parameters"]["properties"]["brain_name"] = {
            "type": "string",
            "enum": brain_names,
            "description": f"Specific brain to search in. Options: {', '.join(brain_names)}"
        }

    # Add document properties if available
    if 'documents' in attribute_values and attribute_values['documents']:
        documents = list(attribute_values['documents'])
        schema["parameters"]["properties"]["document_filter"] = {
            "type": "string",
            "enum": documents,
            "description": f"Filter by specific documents. Options: {', '.join(documents[:10])}" + ("..." if len(documents) > 10 else "")
        }

    return schema, attribute_mapping, brain_tree


def build_tree(brain_documents, brain_relations):
    """
    Build document tree structure.
    
    Args:
        brain_documents: List of brain documents
        brain_relations: Brain relations dictionary
        
    Returns:
        Tuple of (document_tree, brain_tree)
    """
    # Build document tree
    document_tree = []
    if brain_documents:
        # Create a simple tree structure from documents
        for doc in brain_documents:
            if not isinstance(doc, dict):
                if hasattr(doc, 'model_dump'):
                    doc = doc.model_dump()
                elif hasattr(doc, 'dict'):
                    doc = doc.dict()
                else:
                    doc = vars(doc)
            doc_node = {
                "id": doc.get('_id', doc.get('id')),
                "nom": doc.get('filename', doc.get('name', 'Unknown')),
                "file_name": doc.get('file_name') or doc.get('filename', doc.get('name', 'Unknown')),
                "in_memory": doc.get('in_memory', False),
                "children": []
            }

            # Only add type if customType is not None
            custom_type = doc.get('customType')
            if custom_type is not None:
                doc_node["type"] = custom_type

            # Add "parent_folder" from predicted_category only
            predicted_category = doc.get('predicted_category', '')
            if predicted_category:
                doc_node["parent_folder"] = predicted_category

            # Add language field from brain
            if 'language' in doc:
                doc_node["language"] = doc['language']

            # Add excelSheet if not empty and not None
            sheet_name = doc.get('sheetName')
            if sheet_name and sheet_name.strip():
                doc_node["excelSheet"] = sheet_name

            # Add any custom payload attributes
            if 'custom_payload' in doc:
                doc_node.update(doc['custom_payload'])
            document_tree.append(doc_node)

    # Build brain tree
    brain_tree = build_brain_tree(brain_relations) if brain_relations else []
    
    return document_tree, brain_tree

def csrd_json():
    return {
                "name": "perform_csrd_search",
                "strict": True,
                "description": (
                    "Search CSRD (Corporate Sustainability Reporting Directive) normative content. "
                    "This tool can search using specific ESRS patterns (e.g., 'E1-29', 'E1-AR4-b-IV') "
                    "or natural language queries for semantic search. "
                    "Returns structured information including ESRS norms, requirements (exigences), "
                    "data points, and references."
                ),
                "parameters": {
                    "type": "object",
                    "required": ["query"],
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": (
                                "The search query. Can be:\n"
                                "- A specific ESRS pattern (e.g., 'E1-29', 'E1-AR4', 'E1-29-b-IV')\n"
                                "- A natural language question about CSRD requirements\n"
                                "The tool will automatically detect the pattern type and route to "
                                "the appropriate search method (numerical pattern, AR pattern, or semantic search)."
                            )
                        }
                    },
                    "additionalProperties": False
                }
            }

def construct_json(documents):
    # Map to store transformed ids
    documents = copy.deepcopy(documents)
    transformed_id_counter = 1

    # Recursive function to assign transformed ids to documents and collect attributes
    def assign_transformed_ids_and_extract_attributes(docs, attribute_values, attribute_mapping):
        nonlocal transformed_id_counter
        for doc in docs:
            # Assign a transformed id
            original_id = doc.get("id")
            transformed_id = f"id{transformed_id_counter}"
            transformed_id_counter += 1

            # Treat "id" as any other attribute for mapping
            if "id" not in attribute_values:
                attribute_values["id"] = set()
            attribute_values["id"].add(transformed_id)

            if "id" not in attribute_mapping:
                attribute_mapping["id"] = {}
            if transformed_id not in attribute_mapping["id"]:
                attribute_mapping["id"][transformed_id] = []
            attribute_mapping["id"][transformed_id].append(original_id)
            search_file_name = doc.get("file_name") or doc.get("nom")
            if original_id and search_file_name:
                attribute_mapping.setdefault("_file_name_by_id", {})[original_id] = search_file_name

            doc["id"] = transformed_id

            # Process only specific attributes that we want to allow for filtering
            filterable_fields = {"type", "language", "parent_folder"}
            for key, value in doc.items():
                if key in filterable_fields:
                    # Skip None values and empty string values
                    if value is None:
                        continue
                    if isinstance(value, str) and not value.strip():
                        continue

                    if key not in attribute_values:
                        attribute_values[key] = set()
                    attribute_values[key].add(value)

                    # Map attribute values to their corresponding original UUID ids
                    if key not in attribute_mapping:
                        attribute_mapping[key] = {}
                    if value not in attribute_mapping[key]:
                        attribute_mapping[key][value] = []
                    attribute_mapping[key][value].append(original_id)

            # Recursively process children
            if "children" in doc and isinstance(doc["children"], list):
                assign_transformed_ids_and_extract_attributes(doc["children"], attribute_values, attribute_mapping)

    # Dictionary to store unique values for each attribute
    attribute_values = {}
    # Dictionary to map attribute values to their corresponding original UUID ids
    attribute_mapping = {}

    # Assign transformed ids and extract attributes
    assign_transformed_ids_and_extract_attributes(documents, attribute_values, attribute_mapping)

    # Construct the JSON schema
    schema = {
        "name": "perform_document_search",
        "strict": True,
        "description": "Performs a search that outputs a list of chunks with information about the query. "
                       "Do not use the file name or any of the references in the filters in the query.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Requête détaillée en langage naturel utilisée pour rechercher une information. "
                                   "Do NOT include file names or references in the query."
                }
            },
            "required": ["query"],
            "additionalProperties": False
        }
    }

    # Add dynamic properties for all attributes
    for attr, values in attribute_values.items():
        schema["parameters"]["properties"][attr] = {
            "type": ["array", "null"],
            "items": {
                "type": "string",
                "enum": list(values)
            },
            "description": f"List of values for attribute: {attr}"
        }

        # Make parent_folder required along with query
        if attr == "parent_folder":
            schema["parameters"]["required"].append(attr)

    return schema, attribute_mapping, documents

def in_memory_construct_json(documents_tree: List[Dict[str, Any]], in_memory_tool_description: str) -> Tuple[
    Optional[Dict], Optional[Dict], Optional[List]]:
    """
    Constructs JSON schema for the perform_in_memory_extraction function that retrieves complete file context.

    This function creates a schema for extracting the full content of documents loaded in memory,
    allowing the agent to access the complete context of specific files when needed.

    Args:
        documents_tree: List of dictionaries representing documents with their metadata
        in_memory_tool_description: Custom description for the in-memory tool functionality

    Returns:
        Tuple containing:
        - Schema for the perform_in_memory_extraction function
        - Attribute mapping (for consistency with construct_json)
        - List of in-memory documents
    """
    try:
        # Extract all documents for in-memory access
        in_memory_documents = []
        in_memory_filenames = []

        for doc in documents_tree:
            in_memory_documents.append(doc)
            file_name = doc.get('nom', '')
            if file_name:
                in_memory_filenames.append(file_name)

        # If no documents available, return None
        if not in_memory_filenames:
            return None, None, None

        # Build schema for the perform_in_memory_extraction function
        schema = {
            "name": "perform_in_memory_extraction",
            "strict": True,
            "description": in_memory_tool_description,
            "parameters": {
                "type": "object",
                "properties": {
                    "file_name": {
                        "type": "string",
                        "enum": in_memory_filenames,
                        "description": f"Name of the file to retrieve complete context from. Available files: {', '.join(in_memory_filenames)}"
                    }
                },
                "required": ["file_name"],
                "additionalProperties": False
            }
        }

        # Create simple mapping for consistency with construct_json
        attribute_mapping = {
            "file_name": {fn: [doc.get("id")] for doc, fn in zip(in_memory_documents, in_memory_filenames)}
        }

        return schema, attribute_mapping, in_memory_documents
    except Exception as e:
        logger.exception(f"error occurred in in_memory_construct_json: {e}")
        return None, None, None


def convert_sources_structure(sources: List[Document]) -> List[Dict[str, Any]]:
    """
    Convert sources from Document objects to dictionary format.
    
    Args:
        sources: List of Document objects
        
    Returns:
        List of dictionaries with converted source information
    """
    converted_sources = []
    
    for source in sources:
        converted_source = {
            "page_content": source.page_content if hasattr(source, 'page_content') else str(source),
            "metadata": source.metadata if hasattr(source, 'metadata') else {}
        }
        converted_sources.append(converted_source)
    
    return converted_sources
