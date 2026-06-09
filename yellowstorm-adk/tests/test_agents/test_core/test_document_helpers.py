"""Tests for DocumentHelpers."""

import pytest
from unittest.mock import MagicMock, patch
import json

from src.smart_rag.agents.core.document_helpers import DocumentHelpers


class TestDocumentHelpers:
    """Test cases for DocumentHelpers."""

    @patch('src.smart_rag.agents.core.document_helpers.build_tree')
    def test_build_trees_with_data(self, mock_build_tree):
        """Test building trees with valid data."""
        mock_build_tree.return_value = (
            [{"id": "doc1", "name": "Test Doc"}],
            {"nodes": [], "relationships": []}
        )

        user_request = MagicMock()
        user_request.brain_documents = [{"id": "doc1"}]
        user_request.brain_relations = {"nodes": []}

        doc_tree, brain_tree = DocumentHelpers._build_trees(user_request)

        mock_build_tree.assert_called_once_with([{"id": "doc1"}], {"nodes": []})
        assert doc_tree == [{"id": "doc1", "name": "Test Doc"}]
        assert brain_tree == {"nodes": [], "relationships": []}

    def test_build_trees_no_data(self):
        """Test building trees with no data."""
        user_request = MagicMock()
        user_request.brain_documents = None
        user_request.brain_relations = None

        doc_tree, brain_tree = DocumentHelpers._build_trees(user_request)

        assert doc_tree is None
        assert brain_tree is None

    @patch('src.smart_rag.agents.core.document_helpers.build_tree')
    @patch('src.smart_rag.agents.core.document_helpers.logger')
    def test_build_trees_exception(self, mock_logger, mock_build_tree):
        """Test building trees with exception."""
        mock_build_tree.side_effect = Exception("Build failed")

        user_request = MagicMock()
        user_request.brain_documents = [{"id": "doc1"}]
        user_request.brain_relations = {"nodes": []}

        doc_tree, brain_tree = DocumentHelpers._build_trees(user_request)

        mock_logger.error.assert_called_once_with("Failed to build trees: Build failed")
        assert doc_tree is None
        assert brain_tree is None

    def test_store_original_brain_data(self):
        """Test storing original brain data."""
        agent_data = {
            "brain_documents": [{"id": "doc1"}],
            "brain_relations": {"nodes": []},
            "other_field": "value"
        }

        DocumentHelpers._store_original_brain_data(agent_data)

        assert agent_data["_original_brain_documents"] == [{"id": "doc1"}]
        assert agent_data["_original_brain_relations"] == {"nodes": []}
        assert agent_data["other_field"] == "value"

    def test_store_original_brain_data_empty(self):
        """Test storing original brain data when empty."""
        agent_data = {}

        DocumentHelpers._store_original_brain_data(agent_data)

        assert agent_data["_original_brain_documents"] == []
        assert agent_data["_original_brain_relations"] == {}

    def test_extract_document_id(self):
        """Test extracting document ID from various formats."""
        # Test with 'id' field
        doc1 = {"id": "doc123", "name": "Test"}
        assert DocumentHelpers._extract_document_id(doc1) == "doc123"

        # Test with '_id' field
        doc2 = {"_id": "doc456", "name": "Test"}
        assert DocumentHelpers._extract_document_id(doc2) == "doc456"

        # Test with 'document_id' field
        doc3 = {"document_id": "doc789", "name": "Test"}
        assert DocumentHelpers._extract_document_id(doc3) == "doc789"

        # Test with no ID field
        doc4 = {"name": "Test"}
        assert DocumentHelpers._extract_document_id(doc4) is None

    def test_merge_documents_without_duplicates(self):
        """Test merging documents without duplicates."""
        base_docs = [
            {"id": "doc1", "name": "Base Doc 1"},
            {"id": "doc2", "name": "Base Doc 2"}
        ]

        agent_docs = [
            {"id": "doc2", "name": "Agent Doc 2"},  # Duplicate
            {"id": "doc3", "name": "Agent Doc 3"},  # New
            {"_id": "doc4", "name": "Agent Doc 4"}  # New with different ID field
        ]

        result = DocumentHelpers._merge_documents_without_duplicates(base_docs, agent_docs)

        assert len(result) == 4
        assert result[0]["id"] == "doc1"
        assert result[1]["id"] == "doc2"
        assert result[2]["id"] == "doc3"
        assert result[3]["_id"] == "doc4"

    def test_get_base_brain_documents(self):
        """Test getting base brain documents."""
        user_request = MagicMock()
        team = MagicMock()

        # Test with user request documents
        user_request.brain_documents = [{"id": "user_doc"}]
        team.config.doc_tree = [{"id": "team_doc"}]

        result = DocumentHelpers._get_base_brain_documents(user_request, team)
        assert result == [{"id": "user_doc"}]

        # Test with team documents when no user documents
        user_request.brain_documents = None
        result = DocumentHelpers._get_base_brain_documents(user_request, team)
        assert result == [{"id": "team_doc"}]

        # Test with no documents
        team.config.doc_tree = None
        result = DocumentHelpers._get_base_brain_documents(user_request, team)
        assert result == []

    def test_combine_brain_documents(self):
        """Test combining brain documents."""
        agent_data = {
            "_original_brain_documents": [{"id": "agent_doc"}]
        }

        user_request = MagicMock()
        user_request.brain_documents = [{"id": "user_doc"}]

        team = MagicMock()
        team.config.doc_tree = [{"id": "team_doc"}]

        result = DocumentHelpers._combine_brain_documents(agent_data, user_request, team)

        assert len(result) == 2
        assert {"id": "user_doc"} in result
        assert {"id": "agent_doc"} in result

    def test_get_base_brain_relations(self):
        """Test getting base brain relations."""
        user_request = MagicMock()
        team = MagicMock()

        # Test with user request relations
        user_request.brain_relations = {"nodes": ["user_node"]}
        team.config.brain_tree = {"nodes": ["team_node"]}

        result = DocumentHelpers._get_base_brain_relations(user_request, team)
        assert result == {"nodes": ["user_node"]}

        # Test with team relations when no user relations
        user_request.brain_relations = None
        result = DocumentHelpers._get_base_brain_relations(user_request, team)
        assert result == {"nodes": ["team_node"]}

        # Test with no relations
        team.config.brain_tree = None
        result = DocumentHelpers._get_base_brain_relations(user_request, team)
        assert result == {}

    def test_merge_brain_relations(self):
        """Test merging brain relations."""
        base_relations = {
            "nodes": ["base_node1"],
            "relationships": ["base_rel1"]
        }

        agent_relations = {
            "nodes": ["agent_node1"],
            "relationships": ["agent_rel1"]
        }

        result = DocumentHelpers._merge_brain_relations(base_relations, agent_relations)

        assert result["nodes"] == ["base_node1", "agent_node1"]
        assert result["relationships"] == ["base_rel1", "agent_rel1"]

    def test_get_base_workspace_names(self):
        """Test getting base brain ids."""
        user_request = MagicMock()
        team = MagicMock()

        # Test with user request brain ids
        user_request.brain_ids = ["user_brain1", "user_brain2"]
        team.config.brain_ids = ["team_brain1"]

        result = DocumentHelpers._get_base_brain_ids(user_request, team)
        assert result == ["user_brain1", "user_brain2"]

        # Test with team brain ids when no user brain ids
        user_request.brain_ids = None
        result = DocumentHelpers._get_base_brain_ids(user_request, team)
        assert result == ["team_brain1"]

        # Test with no brain ids
        team.config.brain_ids = None
        result = DocumentHelpers._get_base_brain_ids(user_request, team)
        assert result == []

    def test_combine_workspace_names(self):
        """Test combining brain ids."""
        agent_data = {
            "brain_ids": ["agent_brain1", "agent_brain2"]
        }

        user_request = MagicMock()
        user_request.brain_ids = ["user_brain1", "agent_brain1"]  # agent_brain1 is duplicate

        team = MagicMock()
        team.config.brain_ids = ["team_brain1"]

        result = DocumentHelpers._combine_brain_ids(agent_data, user_request, team)

        assert len(result) == 3
        assert "user_brain1" in result
        assert "agent_brain1" in result
        assert "agent_brain2" in result

    def test_populate_brain_data(self):
        """Test populating brain data."""
        agent_data = {
            "brain_documents": [{"id": "agent_doc"}],
            "brain_relations": {"nodes": ["agent_node"]},
            "brain_ids": ["agent_brain"]
        }

        user_request = MagicMock()
        user_request.brain_documents = [{"id": "user_doc"}]
        user_request.brain_relations = {"nodes": ["user_node"]}
        user_request.brain_ids = ["user_brain"]

        team = MagicMock()
        team.config.doc_tree = None
        team.config.brain_tree = None
        team.config.brain_ids = None

        result = DocumentHelpers._populate_brain_data(agent_data, user_request, team)

        assert "_original_brain_documents" in result
        assert "_original_brain_relations" in result
        assert len(result["brain_documents"]) == 2
        assert len(result["brain_ids"]) == 2

    def test_remove_ids_from_tree(self):
        """Test removing IDs from document tree."""
        doc_tree = [
            {
                "id": "doc1",
                "_id": "doc1_alt",
                "document_id": "doc1_doc",
                "name": "Document 1",
                "children": [
                    {
                        "id": "child1",
                        "name": "Child 1"
                    }
                ]
            }
        ]

        result = DocumentHelpers._remove_ids_from_tree(doc_tree)

        assert len(result) == 1
        assert "id" not in result[0]
        assert "_id" not in result[0]
        assert "document_id" not in result[0]
        assert result[0]["name"] == "Document 1"
        assert "id" not in result[0]["children"][0]
        assert result[0]["children"][0]["name"] == "Child 1"

    def test_remove_ids_from_brain_tree(self):
        """Test removing IDs from brain tree."""
        brain_tree = [
            {
                "id": "node1",
                "node_id": "node1_alt",
                "source_id": "source1",
                "target_id": "target1",
                "name": "Node 1",
                "metadata": {
                    "id": "meta1",
                    "description": "Metadata"
                }
            }
        ]

        result = DocumentHelpers._remove_ids_from_brain_tree(brain_tree)

        assert len(result) == 1
        assert "id" not in result[0]
        assert "node_id" not in result[0]
        assert "source_id" not in result[0]
        assert "target_id" not in result[0]
        assert result[0]["name"] == "Node 1"
        assert "id" not in result[0]["metadata"]
        assert result[0]["metadata"]["description"] == "Metadata"

    def test_get_document_tree_info_without_ids(self):
        """Test getting document tree info without IDs."""
        doc_tree = [{"id": "doc1", "name": "Document 1"}]
        brain_tree = [{"id": "node1", "name": "Node 1"}]

        result = DocumentHelpers.get_document_tree_info_without_ids(doc_tree, brain_tree)

        assert "< available_documents_overview >" in result
        assert "< document_relationships_overview >" in result
        assert "\"id\"" not in result
        assert "Document 1" in result
        assert "Node 1" in result

    def test_get_document_tree_info_without_ids_no_tree(self):
        """Test getting document tree info with no tree."""
        result = DocumentHelpers.get_document_tree_info_without_ids(None, None)
        assert result == ""

    def test_get_agent_original_brain_documents(self):
        """Test getting agent's original brain documents."""
        agent = {
            "_original_brain_documents": [{"id": "original_doc"}],
            "brain_documents": [{"id": "merged_doc"}]
        }

        result = DocumentHelpers._get_agent_original_brain_documents(agent)
        assert result == [{"id": "original_doc"}]

        # Test with no original documents
        agent_no_original = {}
        result = DocumentHelpers._get_agent_original_brain_documents(agent_no_original)
        assert result == []

    def test_get_agent_original_brain_relations(self):
        """Test getting agent's original brain relations."""
        agent = {
            "_original_brain_relations": {"nodes": ["original_node"]},
            "brain_relations": {"nodes": ["merged_node"]}
        }

        result = DocumentHelpers._get_agent_original_brain_relations(agent)
        assert result == {"nodes": ["original_node"]}

        # Test with no original relations
        agent_no_original = {}
        result = DocumentHelpers._get_agent_original_brain_relations(agent_no_original)
        assert result == {}

    @patch('src.smart_rag.agents.core.document_helpers.build_tree')
    def test_get_consolidated_document_tree_info_for_manager(self, mock_build_tree):
        """Test getting consolidated document tree info for manager."""
        mock_build_tree.return_value = (
            [{"name": "Agent Doc"}],
            [{"name": "Agent Brain"}]
        )

        config = MagicMock()
        config.doc_tree = [{"name": "Main Doc"}]
        config.brain_tree = [{"name": "Main Brain"}]

        agents = [
            {
                "name": "SearchAgent",
                "tools": ["search"],
                "_original_brain_documents": [{"id": "agent_doc1"}],
                "_original_brain_relations": {"nodes": ["agent_node1"]}
            }
        ]

        result = DocumentHelpers._get_consolidated_document_tree_info_for_manager(config, agents)

        assert "Available to All Search Agents" in result
        assert "Agent-Specific Documents" in result
        assert "SearchAgent" in result

    def test_merge_agents_brain_data_basic(self):
        """Test basic merge of agents brain data."""
        agents = [
            {
                "brain_documents": [{"id": "agent1_doc1"}],
                "brain_relations": {"nodes": [{"id": "node1"}], "relationships": []},
                "workspace_names": ["brain1"]
            },
            {
                "brain_documents": [{"id": "agent2_doc1"}],
                "brain_relations": {"nodes": [{"id": "node2"}], "relationships": []},
                "workspace_names": ["brain2"]
            }
        ]

        user_request = MagicMock()
        user_request.brain_documents = [{"id": "user_doc1"}]
        user_request.brain_relations = {"nodes": [{"id": "user_node"}], "relationships": []}
        user_request.workspace_names = ["user_brain"]

        team = MagicMock()
        team.config.doc_tree = None
        team.config.brain_tree = None
        team.config.workspace_names = None

        merged_docs, merged_rels = DocumentHelpers.merge_agents_brain_data(
            agents, user_request, team
        )

        assert len(merged_docs) == 3  # user_doc1, agent1_doc1, agent2_doc1
        assert len(merged_rels["nodes"]) == 3  # user_node, node1, node2

    def test_merge_agents_brain_data_with_duplicates(self):
        """Test merge of agents brain data with duplicates."""
        agents = [
            {
                "brain_documents": [{"id": "doc1"}, {"id": "doc2"}],
                "brain_relations": {
                    "nodes": [{"id": "node1"}, {"id": "node2"}],
                    "relationships": [{"source": "node1", "target": "node2", "type": "rel"}]
                },
                "workspace_names": ["brain1", "brain2"]
            },
            {
                "brain_documents": [{"id": "doc2"}, {"id": "doc3"}],  # doc2 is duplicate
                "brain_relations": {
                    "nodes": [{"id": "node2"}, {"id": "node3"}],  # node2 is duplicate
                    "relationships": [{"source": "node1", "target": "node2", "type": "rel"}]  # duplicate relationship
                },
                "workspace_names": ["brain2", "brain3"]  # brain2 is duplicate
            }
        ]

        user_request = MagicMock()
        user_request.brain_documents = [{"id": "doc1"}]  # duplicate with agent1
        user_request.brain_relations = {
            "nodes": [{"id": "node1"}],  # duplicate with agent1
            "relationships": []
        }
        user_request.workspace_names = ["brain1"]  # duplicate with agent1

        team = MagicMock()
        team.config.doc_tree = None
        team.config.brain_tree = None
        team.config.workspace_names = None

        merged_docs, merged_rels = DocumentHelpers.merge_agents_brain_data(
            agents, user_request, team
        )

        # Check documents are deduplicated
        assert len(merged_docs) == 3  # doc1, doc2, doc3 (no duplicates)
        doc_ids = [DocumentHelpers._extract_document_id(doc) for doc in merged_docs]
        assert set(doc_ids) == {"doc1", "doc2", "doc3"}

        # Check nodes are deduplicated
        assert len(merged_rels["nodes"]) == 3  # node1, node2, node3 (no duplicates)
        node_ids = [node["id"] for node in merged_rels["nodes"]]
        assert set(node_ids) == {"node1", "node2", "node3"}

        # Check relationships are deduplicated
        assert len(merged_rels["relationships"]) == 1  # Only one unique relationship

    def test_merge_agents_brain_data_empty_agents(self):
        """Test merge with empty agents list."""
        agents = []

        user_request = MagicMock()
        user_request.brain_documents = [{"id": "user_doc"}]
        user_request.brain_relations = {"nodes": [{"id": "user_node"}], "relationships": []}
        user_request.workspace_names = ["user_brain"]

        team = MagicMock()
        team.config.doc_tree = None
        team.config.brain_tree = None
        team.config.workspace_names = None

        merged_docs, merged_rels = DocumentHelpers.merge_agents_brain_data(
            agents, user_request, team
        )

        assert len(merged_docs) == 1
        assert merged_docs[0]["id"] == "user_doc"

    def test_merge_agents_brain_data_with_pydantic_models(self):
        """Test merge with Pydantic model agents."""
        # Mock Pydantic model
        class MockAgent:
            def dict(self):
                return {
                    "brain_documents": [{"id": "pydantic_doc"}],
                    "brain_relations": {"nodes": [], "relationships": []},
                    "workspace_names": ["pydantic_brain"]
                }

        agents = [MockAgent()]

        user_request = MagicMock()
        user_request.brain_documents = []
        user_request.brain_relations = {}
        user_request.workspace_names = []

        team = MagicMock()
        team.config.doc_tree = None
        team.config.brain_tree = None
        team.config.workspace_names = None

        merged_docs, merged_rels = DocumentHelpers.merge_agents_brain_data(
            agents, user_request, team
        )

        assert len(merged_docs) == 1
        assert merged_docs[0]["id"] == "pydantic_doc"

    def test_deduplicate_documents(self):
        """Test deduplication of documents."""
        documents = [
            {"id": "doc1", "name": "Doc 1"},
            {"id": "doc2", "name": "Doc 2"},
            {"id": "doc1", "name": "Doc 1 Duplicate"},  # Duplicate
            {"_id": "doc3", "name": "Doc 3"},
            {"_id": "doc3", "name": "Doc 3 Duplicate"},  # Duplicate
            {"name": "Doc without ID"}  # No ID, should be kept
        ]

        result = DocumentHelpers._deduplicate_documents(documents)

        assert len(result) == 4  # doc1, doc2, doc3, doc without ID
        assert result[0]["id"] == "doc1"
        assert result[1]["id"] == "doc2"
        assert result[2]["_id"] == "doc3"
        assert result[3]["name"] == "Doc without ID"

    def test_deduplicate_relations(self):
        """Test deduplication of relations."""
        relations = {
            "nodes": [
                {"id": "node1", "name": "Node 1"},
                {"id": "node2", "name": "Node 2"},
                {"id": "node1", "name": "Node 1 Duplicate"},  # Duplicate
                {"name": "Node without ID"}  # No ID, should be kept
            ],
            "relationships": [
                {"source": "node1", "target": "node2", "type": "rel1"},
                {"source": "node2", "target": "node3", "type": "rel2"},
                {"source": "node1", "target": "node2", "type": "rel1"},  # Duplicate
                {"source": "node1", "target": "node2", "type": "rel3"}  # Different type, not duplicate
            ]
        }

        result = DocumentHelpers._deduplicate_relations(relations)

        assert len(result["nodes"]) == 3  # node1, node2, node without ID
        assert len(result["relationships"]) == 3  # 3 unique relationships

    def test_deduplicate_relations_empty(self):
        """Test deduplication of empty relations."""
        relations = {}
        result = DocumentHelpers._deduplicate_relations(relations)
        assert result == {}

    def test_deduplicate_relations_invalid_input(self):
        """Test deduplication with invalid input."""
        result = DocumentHelpers._deduplicate_relations("not a dict")
        assert result == "not a dict"

    def test_merge_user_request_brain_documents_into_agents_basic(self):
        """Test merging user_request brain_documents into agents - basic case."""
        agents = [
            {
                "id": "agent1",
                "name": "Agent 1",
                "brain_documents": [{"id": "agent1_doc1"}]
            },
            {
                "id": "agent2",
                "name": "Agent 2",
                "brain_documents": [{"id": "agent2_doc1"}]
            }
        ]

        user_request = MagicMock()
        user_request.brain_documents = [{"id": "user_doc1"}, {"id": "user_doc2"}]

        result = DocumentHelpers.merge_user_request_brain_documents_into_agents(agents, user_request)

        # Check that all agents are returned
        assert len(result) == 2

        # Check that agent1 has merged documents
        assert len(result[0]["brain_documents"]) == 3  # agent1_doc1 + user_doc1 + user_doc2
        agent1_doc_ids = [DocumentHelpers._extract_document_id(doc) for doc in result[0]["brain_documents"]]
        assert "agent1_doc1" in agent1_doc_ids
        assert "user_doc1" in agent1_doc_ids
        assert "user_doc2" in agent1_doc_ids

        # Check that agent2 has merged documents
        assert len(result[1]["brain_documents"]) == 3  # agent2_doc1 + user_doc1 + user_doc2
        agent2_doc_ids = [DocumentHelpers._extract_document_id(doc) for doc in result[1]["brain_documents"]]
        assert "agent2_doc1" in agent2_doc_ids
        assert "user_doc1" in agent2_doc_ids
        assert "user_doc2" in agent2_doc_ids

    def test_merge_user_request_brain_documents_into_agents_with_duplicates(self):
        """Test merging with duplicates - should avoid duplicates."""
        agents = [
            {
                "id": "agent1",
                "name": "Agent 1",
                "brain_documents": [{"id": "doc1"}, {"id": "doc2"}]
            }
        ]

        user_request = MagicMock()
        user_request.brain_documents = [{"id": "doc2"}, {"id": "doc3"}]  # doc2 is duplicate

        result = DocumentHelpers.merge_user_request_brain_documents_into_agents(agents, user_request)

        # Check that duplicates are avoided
        assert len(result[0]["brain_documents"]) == 3  # doc1, doc2, doc3
        doc_ids = [DocumentHelpers._extract_document_id(doc) for doc in result[0]["brain_documents"]]
        assert set(doc_ids) == {"doc1", "doc2", "doc3"}

    def test_merge_user_request_brain_documents_into_agents_no_user_docs(self):
        """Test merging when user_request has no brain_documents."""
        agents = [
            {
                "id": "agent1",
                "name": "Agent 1",
                "brain_documents": [{"id": "agent1_doc1"}]
            }
        ]

        user_request = MagicMock()
        user_request.brain_documents = None

        result = DocumentHelpers.merge_user_request_brain_documents_into_agents(agents, user_request)

        # Should return original agents unchanged
        assert len(result) == 1
        assert result[0]["brain_documents"] == [{"id": "agent1_doc1"}]

    def test_merge_user_request_brain_documents_into_agents_empty_agents(self):
        """Test merging with empty agents list."""
        agents = []

        user_request = MagicMock()
        user_request.brain_documents = [{"id": "user_doc1"}]

        result = DocumentHelpers.merge_user_request_brain_documents_into_agents(agents, user_request)

        # Should return empty list
        assert len(result) == 0

    def test_merge_user_request_brain_documents_into_agents_agent_no_docs(self):
        """Test merging when agent has no brain_documents."""
        agents = [
            {
                "id": "agent1",
                "name": "Agent 1"
                # No brain_documents field
            }
        ]

        user_request = MagicMock()
        user_request.brain_documents = [{"id": "user_doc1"}]

        result = DocumentHelpers.merge_user_request_brain_documents_into_agents(agents, user_request)

        # Agent should now have user documents
        assert len(result[0]["brain_documents"]) == 1
        assert result[0]["brain_documents"][0]["id"] == "user_doc1"

    def test_merge_user_request_brain_documents_into_agents_pydantic_model(self):
        """Test merging with Pydantic model agents."""
        class MockAgent:
            def __init__(self):
                self.id = "agent1"
                self.name = "Agent 1"
                self.brain_documents = [{"id": "agent1_doc1"}]

            def dict(self):
                return {
                    "id": self.id,
                    "name": self.name,
                    "brain_documents": self.brain_documents
                }

        agents = [MockAgent()]

        user_request = MagicMock()
        user_request.brain_documents = [{"id": "user_doc1"}]

        result = DocumentHelpers.merge_user_request_brain_documents_into_agents(agents, user_request)

        # Check that agent has merged documents
        assert len(result[0]["brain_documents"]) == 2
        doc_ids = [DocumentHelpers._extract_document_id(doc) for doc in result[0]["brain_documents"]]
        assert "agent1_doc1" in doc_ids
        assert "user_doc1" in doc_ids

    def test_update_agents_in_list_by_mapping_basic(self):
        """Test updating agents in list by mapping - basic case."""
        target_agents = [
            {"id": "agent1", "name": "Agent 1", "brain_documents": [{"id": "old_doc1"}]},
            {"id": "agent2", "name": "Agent 2", "brain_documents": [{"id": "old_doc2"}]},
            {"id": "agent3", "name": "Agent 3", "brain_documents": [{"id": "old_doc3"}]}
        ]

        updated_agents = [
            {"id": "agent1", "name": "Agent 1", "brain_documents": [{"id": "new_doc1"}]},
            {"id": "agent2", "name": "Agent 2", "brain_documents": [{"id": "new_doc2"}]}
        ]

        DocumentHelpers.update_agents_in_list_by_mapping(target_agents, updated_agents)

        # Check that agent1 and agent2 were updated
        assert target_agents[0]["brain_documents"][0]["id"] == "new_doc1"
        assert target_agents[1]["brain_documents"][0]["id"] == "new_doc2"

        # Check that agent3 was not updated (not in updated_agents)
        assert target_agents[2]["brain_documents"][0]["id"] == "old_doc3"

    def test_update_agents_in_list_by_mapping_by_name(self):
        """Test updating agents by name when ID is not available."""
        target_agents = [
            {"name": "Agent 1", "brain_documents": [{"id": "old_doc1"}]},
            {"name": "Agent 2", "brain_documents": [{"id": "old_doc2"}]}
        ]

        updated_agents = [
            {"name": "Agent 1", "brain_documents": [{"id": "new_doc1"}]}
        ]

        DocumentHelpers.update_agents_in_list_by_mapping(target_agents, updated_agents)

        # Check that agent1 was updated by name
        assert target_agents[0]["brain_documents"][0]["id"] == "new_doc1"

        # Check that agent2 was not updated
        assert target_agents[1]["brain_documents"][0]["id"] == "old_doc2"

    def test_update_agents_in_list_by_mapping_no_match(self):
        """Test updating when no agents match."""
        target_agents = [
            {"id": "agent1", "name": "Agent 1", "brain_documents": [{"id": "old_doc1"}]}
        ]

        updated_agents = [
            {"id": "agent_unknown", "name": "Unknown Agent", "brain_documents": [{"id": "new_doc"}]}
        ]

        DocumentHelpers.update_agents_in_list_by_mapping(target_agents, updated_agents)

        # Check that target agent was not updated
        assert target_agents[0]["brain_documents"][0]["id"] == "old_doc1"

    def test_update_agents_in_list_by_mapping_empty_target(self):
        """Test updating with empty target list."""
        target_agents = []

        updated_agents = [
            {"id": "agent1", "name": "Agent 1", "brain_documents": [{"id": "new_doc1"}]}
        ]

        # Should not raise any error
        DocumentHelpers.update_agents_in_list_by_mapping(target_agents, updated_agents)

        # Target list should remain empty
        assert len(target_agents) == 0

    def test_update_agents_in_list_by_mapping_empty_updated(self):
        """Test updating with empty updated list."""
        target_agents = [
            {"id": "agent1", "name": "Agent 1", "brain_documents": [{"id": "old_doc1"}]}
        ]

        updated_agents = []

        DocumentHelpers.update_agents_in_list_by_mapping(target_agents, updated_agents)

        # Target agent should remain unchanged
        assert target_agents[0]["brain_documents"][0]["id"] == "old_doc1"

    def test_update_agents_in_list_by_mapping_pydantic_models(self):
        """Test updating with Pydantic model agents."""
        class MockAgent:
            def __init__(self, agent_id, brain_docs):
                self.id = agent_id
                self.brain_documents = brain_docs

            def dict(self):
                return {
                    "id": self.id,
                    "brain_documents": self.brain_documents
                }

        target_agents = [MockAgent("agent1", [{"id": "old_doc1"}])]

        updated_agents = [
            {"id": "agent1", "brain_documents": [{"id": "new_doc1"}]}
        ]

        DocumentHelpers.update_agents_in_list_by_mapping(target_agents, updated_agents)

        # Check that the target agent was replaced with the updated dict
        assert isinstance(target_agents[0], dict)
        assert target_agents[0]["brain_documents"][0]["id"] == "new_doc1"

    def test_update_agents_in_list_by_mapping_none_target(self):
        """Test updating with None target list."""
        target_agents = None

        updated_agents = [
            {"id": "agent1", "brain_documents": [{"id": "new_doc1"}]}
        ]

        # Should not raise any error when target is None
        DocumentHelpers.update_agents_in_list_by_mapping(target_agents, updated_agents)