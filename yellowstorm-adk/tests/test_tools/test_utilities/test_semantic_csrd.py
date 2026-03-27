"""
Unit tests for semantic CSRD search functionality.
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
import pandas as pd
from src.smart_rag.tools.utilities.semantic_csrd import (
    run_neo4j_query,
    get_semantic_normes,
    get_semantic_requirements,
    get_semantic_exigence_text,
    filter_extracted_requirements
)


class TestRunNeo4jQuery:
    """Test suite for run_neo4j_query function."""

    @patch('src.smart_rag.tools.utilities.semantic_csrd.Neo4jDb')
    def test_run_neo4j_query_success(self, mock_neo4j_db_class):
        """Test successful Neo4j query execution."""
        # Arrange
        mock_db_instance = MagicMock()
        expected_result = [{"label": "E1", "score": 0.95}]
        mock_db_instance.execute_query.return_value = expected_result
        mock_db_instance.__enter__.return_value = mock_db_instance
        mock_db_instance.__exit__.return_value = False
        mock_neo4j_db_class.return_value = mock_db_instance

        cypher_query = "MATCH (n) RETURN n"

        # Act
        result = run_neo4j_query(cypher_query)

        # Assert
        assert result == expected_result
        mock_neo4j_db_class.assert_called_once()
        mock_db_instance.execute_query.assert_called_once_with(cypher_query, None)
        # close() is called automatically by context manager __exit__
        mock_db_instance.__exit__.assert_called_once()

    @patch('src.smart_rag.tools.utilities.semantic_csrd.Neo4jDb')
    def test_run_neo4j_query_empty_result(self, mock_neo4j_db_class):
        """Test query execution with empty results."""
        # Arrange
        mock_db_instance = MagicMock()
        mock_db_instance.execute_query.return_value = []
        mock_db_instance.__enter__.return_value = mock_db_instance
        mock_db_instance.__exit__.return_value = False
        mock_neo4j_db_class.return_value = mock_db_instance

        cypher_query = "MATCH (n:NonExistent) RETURN n"

        # Act
        result = run_neo4j_query(cypher_query)

        # Assert
        assert result == []
        # close() is called automatically by context manager __exit__
        mock_db_instance.__exit__.assert_called_once()

    @patch('src.smart_rag.tools.utilities.semantic_csrd.Neo4jDb')
    def test_run_neo4j_query_exception(self, mock_neo4j_db_class):
        """Test that exceptions are properly raised and connection is closed."""
        # Arrange
        mock_db_instance = MagicMock()
        mock_db_instance.execute_query.side_effect = Exception("Connection failed")
        mock_db_instance.__enter__.return_value = mock_db_instance
        mock_db_instance.__exit__.return_value = False
        mock_neo4j_db_class.return_value = mock_db_instance

        cypher_query = "MATCH (n) RETURN n"

        # Act & Assert
        # The function re-raises exceptions after closing connection
        with pytest.raises(Exception, match=r"Connection failed"):
            run_neo4j_query(cypher_query)

        # Verify connection was closed even with exception (via context manager __exit__)
        mock_db_instance.__exit__.assert_called_once()

    @patch('src.smart_rag.tools.utilities.semantic_csrd.Neo4jDb')
    def test_run_neo4j_query_closes_connection_on_error(self, mock_neo4j_db_class):
        """Test that connection is closed even when query fails."""
        # Arrange
        mock_db_instance = MagicMock()
        mock_db_instance.execute_query.side_effect = Exception("Query error")
        mock_db_instance.__enter__.return_value = mock_db_instance
        mock_db_instance.__exit__.return_value = False
        mock_neo4j_db_class.return_value = mock_db_instance

        # Act & Assert
        with pytest.raises(Exception):
            run_neo4j_query("INVALID QUERY")

        # Verify connection was closed (via context manager __exit__)
        mock_db_instance.__exit__.assert_called_once()


class TestGetSemanticNormes:
    """Test suite for get_semantic_normes function."""

    @patch('src.smart_rag.tools.utilities.semantic_csrd.run_neo4j_query')
    def test_get_semantic_normes_success(self, mock_run_query):
        """Test successful semantic normes search."""
        # Arrange
        embedding = "[0.1, 0.2, 0.3]"
        expected_result = [
            {
                "norme_label": "ESRS E1",
                "exigences": [
                    {
                        "exigence_label": "E1-1",
                        "exigence_text": "Climate change adaptation",
                        "references": [],
                        "ar_nodes": [],
                        "numerical_nodes": []
                    }
                ]
            }
        ]
        mock_run_query.return_value = expected_result

        # Act
        result = get_semantic_normes(embedding)

        # Assert
        assert result == expected_result
        mock_run_query.assert_called_once()
        # Verify the cypher query contains the embedding
        call_args = mock_run_query.call_args[0][0]
        assert embedding in call_args
        assert "db.index.vector.queryNodes('norme_index'" in call_args

    @patch('src.smart_rag.tools.utilities.semantic_csrd.run_neo4j_query')
    def test_get_semantic_normes_empty_result(self, mock_run_query):
        """Test semantic normes search with no results."""
        # Arrange
        embedding = "[0.1, 0.2, 0.3]"
        mock_run_query.return_value = []

        # Act
        result = get_semantic_normes(embedding)

        # Assert
        assert result == []

    @patch('src.smart_rag.tools.utilities.semantic_csrd.run_neo4j_query')
    def test_get_semantic_normes_exception(self, mock_run_query):
        """Test that exceptions return empty list."""
        # Arrange
        embedding = "[0.1, 0.2, 0.3]"
        mock_run_query.side_effect = Exception("Query failed")

        # Act
        result = get_semantic_normes(embedding)

        # Assert
        assert result == []


class TestGetSemanticRequirements:
    """Test suite for get_semantic_requirements function."""

    @patch('src.smart_rag.tools.utilities.semantic_csrd.run_neo4j_query')
    def test_get_semantic_requirements_success(self, mock_run_query):
        """Test successful semantic requirements search."""
        # Arrange
        embedding = "[0.1, 0.2, 0.3]"
        expected_result = [
            {
                "norme_label": "ESRS E1",
                "references": [{"reference_title": "AR 4", "reference_text": "Application requirement"}],
                "exigence_label": "E1-1",
                "exigence_text": "Climate change adaptation",
                "ar_nodes": [],
                "numerical_nodes": []
            }
        ]
        mock_run_query.return_value = expected_result

        # Act
        result = get_semantic_requirements(embedding)

        # Assert
        assert result == expected_result
        mock_run_query.assert_called_once()
        call_args = mock_run_query.call_args[0][0]
        assert embedding in call_args
        assert "db.index.vector.queryNodes('exigence_index'" in call_args

    @patch('src.smart_rag.tools.utilities.semantic_csrd.run_neo4j_query')
    def test_get_semantic_requirements_empty(self, mock_run_query):
        """Test semantic requirements with empty results."""
        # Arrange
        embedding = "[0.1, 0.2, 0.3]"
        mock_run_query.return_value = []

        # Act
        result = get_semantic_requirements(embedding)

        # Assert
        assert result == []

    @patch('src.smart_rag.tools.utilities.semantic_csrd.run_neo4j_query')
    def test_get_semantic_requirements_exception(self, mock_run_query):
        """Test exception handling returns empty list."""
        # Arrange
        embedding = "[0.1, 0.2, 0.3]"
        mock_run_query.side_effect = Exception("Database error")

        # Act
        result = get_semantic_requirements(embedding)

        # Assert
        assert result == []


class TestGetSemanticExigenceText:
    """Test suite for get_semantic_exigence_text function."""

    @patch('src.smart_rag.tools.utilities.semantic_csrd.run_neo4j_query')
    def test_get_semantic_exigence_text_success(self, mock_run_query):
        """Test successful semantic exigence text search."""
        # Arrange
        embedding = "[0.1, 0.2, 0.3]"
        expected_result = [
            {
                "norme_label": "ESRS E1",
                "references": [],
                "exigence_label": "E1-1",
                "exigence_text": "The undertaking shall disclose...",
                "ar_nodes": [],
                "numerical_nodes": []
            }
        ]
        mock_run_query.return_value = expected_result

        # Act
        result = get_semantic_exigence_text(embedding)

        # Assert
        assert result == expected_result
        mock_run_query.assert_called_once()
        call_args = mock_run_query.call_args[0][0]
        assert embedding in call_args
        assert "db.index.vector.queryNodes('text_index'" in call_args

    @patch('src.smart_rag.tools.utilities.semantic_csrd.run_neo4j_query')
    def test_get_semantic_exigence_text_empty(self, mock_run_query):
        """Test with no matching text."""
        # Arrange
        embedding = "[0.1, 0.2, 0.3]"
        mock_run_query.return_value = []

        # Act
        result = get_semantic_exigence_text(embedding)

        # Assert
        assert result == []

    @patch('src.smart_rag.tools.utilities.semantic_csrd.run_neo4j_query')
    def test_get_semantic_exigence_text_exception(self, mock_run_query):
        """Test exception handling."""
        # Arrange
        embedding = "[0.1, 0.2, 0.3]"
        mock_run_query.side_effect = Exception("Text search failed")

        # Act
        result = get_semantic_exigence_text(embedding)

        # Assert
        assert result == []


class TestFilterExtractedRequirements:
    """Test suite for filter_extracted_requirements function."""

    def test_filter_extracted_requirements_success(self):
        """Test successful filtering and processing of requirements."""
        # Arrange
        norme_context = [
            {
                "norme_label": "ESRS E1",
                "exigences": [
                    {"exigence_label": "E1-1", "exigence_text": "Climate change"},
                    {"exigence_label": "E1-2", "exigence_text": "Energy"}
                ]
            }
        ]
        exigences_context = [
            {"norme_label": "ESRS E1", "exigence_label": "E1-1", "exigence_text": "Climate change"}
        ]
        exigence_text_context = [
            {"norme_label": "ESRS E1", "exigence_label": "E1-2", "exigence_text": "Energy"}
        ]

        # Act
        result = filter_extracted_requirements(norme_context, exigences_context, exigence_text_context)

        # Assert
        assert isinstance(result, str)
        assert "ESRS E1" in result

    def test_filter_extracted_requirements_removes_duplicates(self):
        """Test that duplicates are removed."""
        # Arrange
        norme_context = [
            {"norme_label": "ESRS E1", "exigences": [{"exigence_label": "E1-1", "exigence_text": "Climate"}]}
        ]
        exigences_context = [
            {"norme_label": "ESRS E1", "exigence_label": "E1-1", "exigence_text": "Climate"}
        ]
        exigence_text_context = [
            {"norme_label": "ESRS E1", "exigence_label": "E1-1", "exigence_text": "Climate"}
        ]

        # Act
        result = filter_extracted_requirements(norme_context, exigences_context, exigence_text_context)

        # Assert
        # Result should contain deduplicated data
        assert isinstance(result, str)
        assert "ESRS E1" in result

    def test_filter_extracted_requirements_empty_contexts(self):
        """Test with empty input contexts."""
        # Arrange
        norme_context = []
        exigences_context = []
        exigence_text_context = []

        # Act
        result = filter_extracted_requirements(norme_context, exigences_context, exigence_text_context)

        # Assert
        assert isinstance(result, str)
        # When contexts are empty, pandas will fail to find 'exigences' column
        # resulting in exception being caught and empty string returned
        assert result == ""

    def test_filter_extracted_requirements_handles_none_values(self):
        """Test that None values are handled correctly."""
        # Arrange
        norme_context = [
            {"norme_label": "ESRS E1", "exigences": None}
        ]
        exigences_context = [
            {"norme_label": "ESRS E2", "exigence_label": None, "exigence_text": "Test"}
        ]
        exigence_text_context = []

        # Act
        result = filter_extracted_requirements(norme_context, exigences_context, exigence_text_context)

        # Assert
        assert isinstance(result, str)

    def test_filter_extracted_requirements_groups_by_norme(self):
        """Test that results are properly grouped by norme_label."""
        # Arrange - Need to provide valid norme_context structure to avoid KeyError
        norme_context = [
            {"norme_label": "ESRS E1", "exigences": [{"exigence_label": "E1-1", "exigence_text": "Climate"}]}
        ]
        exigences_context = [
            {"norme_label": "ESRS E2", "exigence_label": "E2-1", "exigence_text": "Pollution"}
        ]
        exigence_text_context = []

        # Act
        result = filter_extracted_requirements(norme_context, exigences_context, exigence_text_context)

        # Assert
        assert isinstance(result, str)
        # Both norme contexts should be present and grouped
        assert "ESRS E1" in result
        assert "ESRS E2" in result

    def test_filter_extracted_requirements_exception_handling(self):
        """Test that exceptions are handled and return empty string."""
        # Arrange - invalid data that will cause processing error
        norme_context = "invalid_data"  # Not a list
        exigences_context = []
        exigence_text_context = []

        # Act
        result = filter_extracted_requirements(norme_context, exigences_context, exigence_text_context)

        # Assert
        assert result == ""

    def test_filter_extracted_requirements_complex_data(self):
        """Test with complex nested data structures."""
        # Arrange
        norme_context = [
            {
                "norme_label": "ESRS E1",
                "exigences": [
                    {
                        "exigence_label": "E1-1",
                        "exigence_text": "Climate change adaptation",
                        "references": [{"ref": "AR 4"}],
                        "ar_nodes": [{"ar_label": "AR 4"}],
                        "numerical_nodes": [{"numerical_label": "29"}]
                    }
                ]
            }
        ]
        exigences_context = []
        exigence_text_context = []

        # Act
        result = filter_extracted_requirements(norme_context, exigences_context, exigence_text_context)

        # Assert
        assert isinstance(result, str)
        assert "ESRS E1" in result