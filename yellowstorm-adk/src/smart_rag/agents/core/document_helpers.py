"""
Helper functions for managing and merging document trees and brain data for agents.

This module provides utilities to build, merge, and format document and brain trees
from various sources including user requests, team configurations, and agent-specific
"""


import json
from typing import List, Optional, Dict, Any

from src.smart_rag.tools import build_tree
from src.logger.logging import get_logger

logger = get_logger("api.routers.agentic_rag.document_helpers")

class DocumentHelpers:

    @staticmethod
    def _build_trees(user_request) -> tuple[Optional[List[Any]], Optional[List[Any]]]:
        """Build document and brain trees if data is available.

        Constructs hierarchical document and brain tree structures from the provided
        data in the user request, enabling agents to understand available knowledge sources.

        Args:
            user_request (RunAgentTeamRequest): The user request containing brain documents and relations.

        Returns:
            tuple: (documents_tree, brain_tree) or (None, None) if building fails or no data available.

        Raises:
            Exception: Logs error if tree building fails but doesn't propagate exception.
        """
        documents_tree, brain_tree = None, None

        if user_request.brain_documents or user_request.brain_relations:
            try:
                documents_tree, brain_tree = build_tree(
                    user_request.brain_documents or [],
                    user_request.brain_relations or {}
                )
            except Exception as e:
                logger.error(f"Failed to build trees: {str(e)}")

        return documents_tree, brain_tree
        
    @staticmethod
    def _store_original_brain_data(agent_data: dict) -> None:
        """Store original brain data before merging for manager prompt optimization."""
        agent_data['_original_brain_documents'] = agent_data.get('brain_documents', [])
        agent_data['_original_brain_relations'] = agent_data.get('brain_relations', {})


    @staticmethod
    def _combine_brain_documents(agent_data: dict, user_request, team) -> List:
        """Combine brain_documents from user request, team config, and agent's own configuration."""
        combined_documents = []
        original_documents = agent_data.get('_original_brain_documents', [])

        # Add base documents (user request or team config)
        base_documents = DocumentHelpers._get_base_brain_documents(user_request, team)
        combined_documents.extend(base_documents)

        # Add agent-specific documents without duplicates
        if original_documents:
            combined_documents = DocumentHelpers._merge_documents_without_duplicates(combined_documents, original_documents)

        return combined_documents


    @staticmethod
    def _get_base_brain_documents(user_request, team) -> List:
        """Get base brain documents from user request or team config."""
        if user_request.brain_documents:
            return user_request.brain_documents
        elif team.config.doc_tree:
            return team.config.doc_tree
        return []


    @staticmethod
    def _merge_documents_without_duplicates(base_documents: List, agent_documents: List) -> List:
        """Merge agent documents with base documents, avoiding duplicates."""
        existing_doc_ids = {
            DocumentHelpers._extract_document_id(doc)
            for doc in base_documents
            if isinstance(doc, dict) and DocumentHelpers._extract_document_id(doc) is not None
        }

        result_documents = list(base_documents)

        for doc in agent_documents:
            doc_id = DocumentHelpers._extract_document_id(doc) if isinstance(doc, dict) else None

            if doc_id is None or doc_id not in existing_doc_ids:
                result_documents.append(doc)
                if doc_id:
                    existing_doc_ids.add(doc_id)

        return result_documents


    @staticmethod
    def _extract_document_id(doc: dict) -> Optional[str]:
        """Extract document ID from document dictionary."""
        return doc.get('id') or doc.get('_id') or doc.get('document_id')


    @staticmethod
    def _combine_brain_relations(agent_data: dict, user_request, team) -> dict:
        """Combine brain_relations from user request, team config, and agent's own configuration."""
        original_relations = agent_data.get('_original_brain_relations', {})

        # Get base relations
        combined_relations = DocumentHelpers._get_base_brain_relations(user_request, team)

        # Merge agent-specific relations
        if original_relations and isinstance(original_relations, dict):
            combined_relations = DocumentHelpers._merge_brain_relations(combined_relations, original_relations)

        return combined_relations


    @staticmethod
    def _combine_brain_ids(agent_data: dict, user_request, team) -> List[str]:
        """Combine brain_ids from user request, team config, and agent's own configuration."""
        combined_ids = []

        # Add base brain IDs
        base_ids = DocumentHelpers._get_base_brain_ids(user_request, team)
        combined_ids.extend(base_ids)

        # Add agent-specific brain IDs without duplicates
        agent_brain_ids = agent_data.get('brain_ids', [])
        for brain_id in agent_brain_ids:
            if brain_id not in combined_ids:
                combined_ids.append(brain_id)

        return combined_ids


    @staticmethod
    def _get_base_brain_ids(user_request, team) -> List[str]:
        """Get base brain IDs from user request or team config."""
        if user_request.brain_ids:
            return user_request.brain_ids
        elif team.config.brain_ids:
            return team.config.brain_ids
        return []


    @staticmethod
    def _get_base_brain_relations(user_request, team) -> dict:
        """Get base brain relations from user request or team config."""
        if user_request.brain_relations:
            return dict(user_request.brain_relations)
        elif team.config.brain_tree and isinstance(team.config.brain_tree, dict):
            return dict(team.config.brain_tree)
        return {}


    @staticmethod
    def _merge_brain_relations(base_relations: dict, agent_relations: dict) -> dict:
        """Merge agent relations with base relations."""
        result_relations = dict(base_relations)

        for key in ['nodes', 'relationships']:
            if key in agent_relations:
                base_items = result_relations.get(key, [])
                base_items.extend(agent_relations[key])
                result_relations[key] = base_items

        return result_relations



    @staticmethod
    def _populate_brain_data(agent_data, user_request, team) -> dict:
        """Merge brain_documents and brain_ids from user request and agent's own configuration.

        Populates brain documents and relations for agents that have search capabilities,
        using data from the user request or falling back to team defaults.

        Args:
            agent_data: Agent configuration dictionary to update.
            user_request: User request containing brain documents and relations.
            team: Team configuration with default document and brain trees.

        Returns:
            dict: Updated agent data with populated brain documents and relations.
        """
        # Store original data before merging
        DocumentHelpers._store_original_brain_data(agent_data)

        # Combine all brain data types
        agent_data['brain_documents'] = DocumentHelpers._combine_brain_documents(agent_data, user_request, team)
        agent_data['brain_relations'] = DocumentHelpers._combine_brain_relations(agent_data, user_request, team)
        agent_data['brain_ids'] = DocumentHelpers._combine_brain_ids(agent_data, user_request, team)

        return agent_data


    @staticmethod
    def get_document_tree_info_without_ids(doc_tree: Optional[List], brain_tree: Optional[List]) -> str:
        """Get formatted document tree information without IDs for manager context."""
        if not doc_tree:
            return ""

        # Create a copy without IDs
        doc_tree_no_ids = DocumentHelpers._remove_ids_from_tree(doc_tree)

        tree_info = f"\n\n< available_documents_overview >\n{json.dumps(doc_tree_no_ids, indent=4)}\n</ available_documents_overview >"

        if brain_tree:
            brain_tree_no_ids = DocumentHelpers._remove_ids_from_brain_tree(brain_tree)
            tree_info += f"\n\n< document_relationships_overview >\n{json.dumps(brain_tree_no_ids, indent=4)}\n</ document_relationships_overview >"

        return tree_info


    @staticmethod
    def _remove_ids_from_tree(doc_tree: List) -> List:
        """Remove IDs from document tree, keeping only filenames and types."""
        if not doc_tree:
            return []

        cleaned_tree = []
        for item in doc_tree:
            if isinstance(item, dict):
                cleaned_item = {}
                for key, value in item.items():
                    if key not in ['id', '_id', 'document_id']:  # Remove various ID fields
                        if key == 'children' and isinstance(value, list):
                            cleaned_item[key] = DocumentHelpers._remove_ids_from_tree(value)
                        else:
                            cleaned_item[key] = value
                cleaned_tree.append(cleaned_item)
            else:
                cleaned_tree.append(item)

        return cleaned_tree


    @staticmethod
    def _remove_ids_from_brain_tree(brain_tree: List) -> List:
        """Remove IDs from brain tree, keeping only relationships and metadata."""
        if not brain_tree:
            return []

        cleaned_tree = []
        for item in brain_tree:
            if isinstance(item, dict):
                cleaned_item = {}
                for key, value in item.items():
                    if key not in ['id', '_id', 'node_id', 'source_id', 'target_id']:  # Remove various ID fields
                        if isinstance(value, list):
                            cleaned_item[key] = DocumentHelpers._remove_ids_from_brain_tree(value)
                        elif isinstance(value, dict):
                            # Recursively clean nested dictionaries
                            cleaned_value = {}
                            for nested_key, nested_value in value.items():
                                if nested_key not in ['id', '_id', 'node_id', 'source_id', 'target_id']:
                                    cleaned_value[nested_key] = nested_value
                            cleaned_item[key] = cleaned_value
                        else:
                            cleaned_item[key] = value
                cleaned_tree.append(cleaned_item)
            else:
                cleaned_tree.append(item)

        return cleaned_tree


    @staticmethod
    def _get_consolidated_document_tree_info_for_manager(config, agents) -> str:
        """Get consolidated document tree info optimized to reduce duplication in manager prompt."""
        consolidated_info_parts = []

        # Add user request documents ONCE (available to all search agents)
        if config.doc_tree:
            main_tree_info = DocumentHelpers.get_document_tree_info_without_ids(
                config.doc_tree, config.brain_tree
            )
            if main_tree_info:
                consolidated_info_parts.append(f"\n\n## Available to All Search Agents{main_tree_info}")

        # Compute signature for the main tree so we can skip duplicates
        main_tree_signature = json.dumps(config.doc_tree, sort_keys=True) if config.doc_tree else None

        # Collect ONLY agent-specific documents (excluding user request documents)
        agent_specific_trees = {}
        for agent in agents:
            agent_name = agent.get('name', 'unnamed')

            # Check if agent has search tools and its own document configuration
            tools = agent.get('tools', []) or []
            has_search_tool = any(
                (isinstance(tool, dict) and tool.get('name', '').lower() == 'search') or
                (isinstance(tool, str) and tool.lower() == 'search') or (isinstance(tool, dict) and tool.get('name', '').lower() ==
                                                                 'code interpreter') or (isinstance(tool, str) and tool.lower() == 'code interpreter')
                for tool in tools
            )
            if has_search_tool:
                # Get only the agent's original brain_documents/relations (before merging)
                original_brain_documents = DocumentHelpers._get_agent_original_brain_documents(agent)
                original_brain_relations = DocumentHelpers._get_agent_original_brain_relations(agent)

                if original_brain_documents or original_brain_relations:
                    try:
                        # Build tree for agent-specific documents only
                        doc_tree, brain_tree = build_tree(
                            original_brain_documents or [],
                            original_brain_relations or {}
                        )

                        if doc_tree:
                            # Create a signature for this tree to avoid duplicates
                            tree_signature = json.dumps(doc_tree, sort_keys=True)

                            # Skip if identical to the main tree (already shown above)
                            if tree_signature == main_tree_signature:
                                continue

                            # Get tree info without IDs
                            agent_tree_info = DocumentHelpers.get_document_tree_info_without_ids(
                                doc_tree, brain_tree
                            )

                            if agent_tree_info:
                                if tree_signature not in agent_specific_trees:
                                    agent_specific_trees[tree_signature] = {
                                        'info': agent_tree_info,
                                        'agents': [agent_name]
                                    }
                                else:
                                    agent_specific_trees[tree_signature]['agents'].append(agent_name)

                    except Exception as e:
                        logger.error(f"Failed to build tree for agent {agent_name}: {str(e)}")
                        continue

        # Add agent-specific document trees (only if they exist)
        if agent_specific_trees:
            for idx, (tree_signature, tree_data) in enumerate(agent_specific_trees.items(), 1):
                agents_list = ", ".join(tree_data['agents'])
                consolidated_info_parts.append(
                    f"\n\n## Agent-Specific Documents (Agent{'s' if len(tree_data['agents']) > 1 else ''}: {agents_list})"
                    f"{tree_data['info']}"
                )

        return "".join(consolidated_info_parts) if consolidated_info_parts else ""


    @staticmethod
    def _get_agent_original_brain_documents(agent: Dict[str, Any]) -> List:
        """Get agent's original brain_documents (before merging with user request)."""
        return agent.get('_original_brain_documents', [])


    @staticmethod
    def _get_agent_original_brain_relations(agent: Dict[str, Any]) -> Dict:
        """Get agent's original brain_relations (before merging with user request)."""
        return agent.get('_original_brain_relations', {})

    @staticmethod
    def merge_agents_brain_data(agents: List[Dict[str, Any]], user_request, team) -> tuple[List, Dict]:
        """Merge brain documents, relations, and IDs from multiple agents with user request and team data.

        This function consolidates brain data from:
        1. User request (root documents)
        2. Team configuration (fallback)
        3. All provided agents' brain data

        Optimized to filter duplicates after merge to ensure data integrity.

        Args:
            agents: List of agent configurations to merge brain data from
            user_request: User request containing root brain documents and relations
            team: Team configuration with default document and brain trees

        Returns:
            tuple: (merged_brain_documents, merged_brain_relations)
        """
        import copy

        try:
            # Start with base data from user request or team
            # Use deep copy to avoid mutating team defaults
            merged_documents = copy.deepcopy(DocumentHelpers._get_base_brain_documents(user_request, team))
            merged_relations = copy.deepcopy(DocumentHelpers._get_base_brain_relations(user_request, team))

            # Track document IDs to avoid duplicates
            existing_doc_ids = {
                DocumentHelpers._extract_document_id(doc)
                for doc in merged_documents
                if isinstance(doc, dict) and DocumentHelpers._extract_document_id(doc) is not None
            }

            # Merge brain data from each agent
            for agent in agents:
                try:
                    agent_dict = DocumentHelpers.agent_to_dict(agent)

                    # Merge brain_documents
                    agent_brain_docs = agent_dict.get('brain_documents', [])
                    for doc in agent_brain_docs:
                        try:
                            doc_id = DocumentHelpers._extract_document_id(doc) if isinstance(doc, dict) else None

                            if doc_id is None or doc_id not in existing_doc_ids:
                                merged_documents.append(doc)
                                if doc_id:
                                    existing_doc_ids.add(doc_id)
                        except Exception as e:
                            logger.error(f"Error merging document: {str(e)}")
                            continue

                    # Merge brain_relations
                    agent_brain_relations = agent_dict.get('brain_relations', {})
                    if agent_brain_relations and isinstance(agent_brain_relations, dict):
                        merged_relations = DocumentHelpers._merge_brain_relations(merged_relations, agent_brain_relations)

                except Exception as e:
                    logger.exception(f"Error merging brain data for agent '{agent_dict.get('name', 'unknown') if 'agent_dict' in locals() else 'unknown'}': {str(e)}")
                    continue

            # Final deduplication pass to ensure no duplicates slipped through
            merged_documents = DocumentHelpers._deduplicate_documents(merged_documents)
            merged_relations = DocumentHelpers._deduplicate_relations(merged_relations)

            return merged_documents, merged_relations

        except Exception as e:
            logger.exception(f"Error in merge_agents_brain_data: {str(e)}")
            # Return base data as fallback
            return (
                DocumentHelpers._get_base_brain_documents(user_request, team),
                DocumentHelpers._get_base_brain_relations(user_request, team)
            )

    @staticmethod
    def _deduplicate_documents(documents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Remove duplicate documents based on their IDs.

        Args:
            documents: List of document dictionaries to deduplicate

        Returns:
            List of unique documents
        """
        seen_ids = set()
        unique_documents = []

        for doc in documents:
            if not isinstance(doc, dict):
                unique_documents.append(doc)
                continue

            doc_id = DocumentHelpers._extract_document_id(doc)

            if doc_id is None:
                # Keep documents without IDs (though log a warning in production)
                unique_documents.append(doc)
            elif doc_id not in seen_ids:
                seen_ids.add(doc_id)
                unique_documents.append(doc)

        return unique_documents

    @staticmethod
    def _deduplicate_relations(relations: Dict[str, Any]) -> Dict[str, Any]:
        """Remove duplicate relations (nodes and relationships).

        Args:
            relations: Dictionary containing 'nodes' and 'relationships' lists

        Returns:
            Dictionary with deduplicated nodes and relationships
        """
        if not isinstance(relations, dict):
            return relations

        deduplicated = {}

        # Deduplicate nodes
        if 'nodes' in relations:
            seen_node_ids = set()
            unique_nodes = []

            for node in relations['nodes']:
                if not isinstance(node, dict):
                    unique_nodes.append(node)
                    continue

                node_id = node.get('id') or node.get('_id')
                if node_id is None:
                    unique_nodes.append(node)
                elif node_id not in seen_node_ids:
                    seen_node_ids.add(node_id)
                    unique_nodes.append(node)

            deduplicated['nodes'] = unique_nodes

        # Deduplicate relationships
        if 'relationships' in relations:
            seen_relationships = set()
            unique_relationships = []

            for rel in relations['relationships']:
                if not isinstance(rel, dict):
                    unique_relationships.append(rel)
                    continue

                # Create a signature for the relationship
                source = rel.get('source')
                target = rel.get('target')
                rel_type = rel.get('type', '')
                rel_signature = (source, target, rel_type)

                if rel_signature not in seen_relationships:
                    seen_relationships.add(rel_signature)
                    unique_relationships.append(rel)

            deduplicated['relationships'] = unique_relationships

        return deduplicated

    @staticmethod
    def agent_to_dict(agent) -> Dict[str, Any]:
        """Convert agent (dict, Pydantic model, or object) to dictionary.

        Args:
            agent: Agent in any format (dict, Pydantic model, or object)

        Returns:
            Dictionary representation of the agent
        """
        if isinstance(agent, dict):
            return agent
        elif hasattr(agent, 'model_dump'):
            # Pydantic V2
            return agent.model_dump()
        elif hasattr(agent, 'dict'):
            # Pydantic V1 (deprecated but still supported)
            return agent.dict()
        else:
            # Regular object with attributes
            return vars(agent)

    @staticmethod
    def update_agents_in_list_by_mapping(target_agents_list: List, updated_agents: List[Dict[str, Any]]) -> None:
        """Update agents in a target list by mapping on agent ID or name.

        This function updates agents in-place within the target list by finding matching
        agents from the updated_agents list based on their ID or name.

        Args:
            target_agents_list: List of agents to update (modified in-place)
            updated_agents: List of agents with updated data to apply
        """
        # Create a mapping of updated agents by their ID or name
        try:
            updated_agents_map = {}
            for updated_agent in updated_agents:
                # Convert to dict if it's an object (AgentSuggestion, etc.)
                updated_agent_dict = DocumentHelpers.agent_to_dict(updated_agent)
                agent_id = updated_agent_dict.get('id') or updated_agent_dict.get('name')
                if agent_id:
                    updated_agents_map[agent_id] = updated_agent_dict

            # Update agents in target list using the mapping
            for i, agent in enumerate(target_agents_list or []):
                agent_dict = DocumentHelpers.agent_to_dict(agent)
                agent_id = agent_dict.get('id') or agent_dict.get('name')

                # If this agent was updated, replace it
                if agent_id and agent_id in updated_agents_map:
                    target_agents_list[i] = updated_agents_map[agent_id]
        except Exception as e:
            logger.exception(f"error updating agents: {str(e)}")

    @staticmethod
    def merge_user_request_brain_documents_into_agents(agents: List[Dict[str, Any]], user_request) -> List[Dict[str, Any]]:
        """Merge user_request brain_documents into each agent's brain_documents.

        This function creates updated copies of agents with merged brain_documents
        from the user_request, avoiding duplicates.

        Args:
            agents: List of agent configurations to update
            user_request: User request containing brain_documents to merge

        Returns:
            List of agents with updated brain_documents
        """
        import copy

        try:
            user_brain_docs = user_request.brain_documents or []

            if not user_brain_docs:
                return agents  # Nothing to merge, return original agents

            updated_agents = []

            for agent in agents:
                try:
                    # Convert agent to dict using our helper function
                    agent_dict = DocumentHelpers.agent_to_dict(agent)

                    # Deep copy to avoid mutating the original
                    agent_dict = copy.deepcopy(agent_dict)

                    # Get agent's current brain_documents
                    agent_brain_docs = agent_dict.get('brain_documents', [])

                    # Track existing agent document IDs
                    agent_doc_ids = {
                        DocumentHelpers._extract_document_id(doc)
                        for doc in agent_brain_docs
                        if isinstance(doc, dict) and DocumentHelpers._extract_document_id(doc) is not None
                    }

                    # Merge user_request brain_documents into agent's brain_documents
                    merged_docs = list(agent_brain_docs) if agent_brain_docs else []

                    for doc in user_brain_docs:
                        doc_id = DocumentHelpers._extract_document_id(doc) if isinstance(doc, dict) else None

                        # Add document if it's not already in agent's documents
                        if doc_id is None or doc_id not in agent_doc_ids:
                            merged_docs.append(copy.deepcopy(doc))
                            if doc_id:
                                agent_doc_ids.add(doc_id)

                    # Update agent's brain_documents with merged data
                    agent_dict['brain_documents'] = merged_docs
                    updated_agents.append(agent_dict)

                except Exception as e:
                    logger.exception(f"Error merging brain documents for agent '{agent_dict.get('name', 'unknown') if 'agent_dict' in locals() else 'unknown'}': {str(e)}")
                    # On error, try to keep the original agent as dict
                    try:
                        updated_agents.append(DocumentHelpers.agent_to_dict(agent))
                    except:
                        logger.error(f"Failed to convert agent to dict, skipping agent")

            return updated_agents

        except Exception as e:
            logger.exception(f"Error in merge_user_request_brain_documents_into_agents: {str(e)}")
            # Return original agents as fallback
            return agents