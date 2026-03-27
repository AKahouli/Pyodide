"""
Unit tests for Neo4j database connection and query execution.
"""

import pytest
from unittest.mock import Mock, MagicMock, patch
from src.smart_rag.tools.utilities.neo4j_db import Neo4jDb


class TestNeo4jDb:
    """Test suite for Neo4jDb class."""

    @pytest.fixture
    def mock_driver(self):
        """Create a mock Neo4j driver."""
        with patch('src.smart_rag.tools.utilities.neo4j_db.GraphDatabase.driver') as mock:
            yield mock

    @pytest.fixture
    def neo4j_db(self, mock_driver):
        """Create Neo4jDb instance with mocked driver."""
        db = Neo4jDb(
            uri="bolt://localhost:7687",
            user="test_user",
            password="test_password"
        )
        return db

    def test_init_creates_driver(self, mock_driver):
        """Test that __init__ creates a Neo4j driver with correct parameters."""
        # Arrange
        uri = "bolt://localhost:7687"
        user = "test_user"
        password = "test_password"

        # Act
        db = Neo4jDb(uri, user, password)

        # Assert
        assert db.uri == uri
        assert db.user == user
        assert db.password == password
        mock_driver.assert_called_once_with(uri, auth=(user, password), max_connection_lifetime=3600)

    def test_close_closes_driver(self, neo4j_db, mock_driver):
        """Test that close method closes the driver connection."""
        # Arrange
        mock_driver_instance = mock_driver.return_value

        # Act
        neo4j_db.close()

        # Assert
        mock_driver_instance.close.assert_called_once()

    def test_close_with_no_driver(self):
        """Test that close method handles None driver gracefully."""
        # Arrange
        with patch('src.smart_rag.tools.utilities.neo4j_db.GraphDatabase.driver'):
            db = Neo4jDb("bolt://localhost:7687", "user", "pass")
            db.driver = None

            # Act & Assert - should not raise exception
            db.close()

    def test_execute_query_returns_results(self, neo4j_db, mock_driver):
        """Test that execute_query returns results from Neo4j."""
        # Arrange
        mock_session = MagicMock()
        mock_driver_instance = mock_driver.return_value
        mock_driver_instance.session.return_value.__enter__.return_value = mock_session

        mock_record1 = Mock()
        mock_record1.data.return_value = {"name": "Node1", "value": 10}
        mock_record2 = Mock()
        mock_record2.data.return_value = {"name": "Node2", "value": 20}

        mock_result = Mock()
        mock_result.__iter__ = Mock(return_value=iter([mock_record1, mock_record2]))
        mock_session.run.return_value = mock_result

        query = "MATCH (n) RETURN n"
        parameters = {"limit": 10}

        # Act
        result = neo4j_db.execute_query(query, parameters)

        # Assert
        assert len(result) == 2
        assert result[0] == {"name": "Node1", "value": 10}
        assert result[1] == {"name": "Node2", "value": 20}
        mock_session.run.assert_called_once_with(query, parameters)

    def test_execute_query_with_no_parameters(self, neo4j_db, mock_driver):
        """Test that execute_query works without parameters."""
        # Arrange
        mock_session = MagicMock()
        mock_driver_instance = mock_driver.return_value
        mock_driver_instance.session.return_value.__enter__.return_value = mock_session

        mock_record = Mock()
        mock_record.data.return_value = {"count": 5}
        mock_result = Mock()
        mock_result.__iter__ = Mock(return_value=iter([mock_record]))
        mock_session.run.return_value = mock_result

        query = "MATCH (n) RETURN count(n) as count"

        # Act
        result = neo4j_db.execute_query(query)

        # Assert
        assert len(result) == 1
        assert result[0] == {"count": 5}
        mock_session.run.assert_called_once_with(query, {})

    def test_execute_query_returns_empty_list(self, neo4j_db, mock_driver):
        """Test that execute_query returns empty list when no results."""
        # Arrange
        mock_session = MagicMock()
        mock_driver_instance = mock_driver.return_value
        mock_driver_instance.session.return_value.__enter__.return_value = mock_session

        mock_result = Mock()
        mock_result.__iter__ = Mock(return_value=iter([]))
        mock_session.run.return_value = mock_result

        query = "MATCH (n:NonExistent) RETURN n"

        # Act
        result = neo4j_db.execute_query(query)

        # Assert
        assert result == []
        mock_session.run.assert_called_once()

    def test_execute_query_handles_complex_data(self, neo4j_db, mock_driver):
        """Test that execute_query handles complex nested data structures."""
        # Arrange
        mock_session = MagicMock()
        mock_driver_instance = mock_driver.return_value
        mock_driver_instance.session.return_value.__enter__.return_value = mock_session

        mock_record = Mock()
        complex_data = {
            "node": {"label": "E1", "embedding": [0.1, 0.2, 0.3]},
            "relationships": [
                {"type": "has_exigence", "target": "exigence1"},
                {"type": "refers_to", "target": "reference1"}
            ]
        }
        mock_record.data.return_value = complex_data
        mock_result = Mock()
        mock_result.__iter__ = Mock(return_value=iter([mock_record]))
        mock_session.run.return_value = mock_result

        query = "MATCH (n)-[r]->(m) RETURN n, collect(r) as relationships"

        # Act
        result = neo4j_db.execute_query(query)

        # Assert
        assert len(result) == 1
        assert result[0] == complex_data

    def test_context_manager_closes_session(self, neo4j_db, mock_driver):
        """Test that session is properly closed after query execution."""
        # Arrange
        mock_session = MagicMock()
        mock_driver_instance = mock_driver.return_value
        mock_driver_instance.session.return_value.__enter__.return_value = mock_session
        mock_driver_instance.session.return_value.__exit__ = MagicMock()

        mock_result = Mock()
        mock_result.__iter__ = Mock(return_value=iter([]))
        mock_session.run.return_value = mock_result

        # Act
        neo4j_db.execute_query("MATCH (n) RETURN n")

        # Assert
        mock_driver_instance.session.return_value.__exit__.assert_called_once()

    def test_execute_query_with_cypher_injection_params(self, neo4j_db, mock_driver):
        """Test that parameters are properly passed to prevent injection."""
        # Arrange
        mock_session = MagicMock()
        mock_driver_instance = mock_driver.return_value
        mock_driver_instance.session.return_value.__enter__.return_value = mock_session

        mock_result = Mock()
        mock_result.__iter__ = Mock(return_value=iter([]))
        mock_session.run.return_value = mock_result

        query = "MATCH (n:Node) WHERE n.id = $node_id RETURN n"
        parameters = {"node_id": "test'; DROP TABLE nodes; --"}

        # Act
        neo4j_db.execute_query(query, parameters)

        # Assert
        # Verify that parameters are passed properly to prevent injection
        mock_session.run.assert_called_once_with(query, parameters)