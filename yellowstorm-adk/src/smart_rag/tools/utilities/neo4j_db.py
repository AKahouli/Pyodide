from neo4j import GraphDatabase
from typing import Dict, List, Optional, Any
from contextlib import contextmanager


class Neo4jDb:
    """Neo4j database connection handler with context manager support."""

    def __init__(self, uri: str, user: str, password: str, max_connection_lifetime: int = 3600):
        """
        Initialize connection to Neo4j database.

        :param uri: Connection URL (e.g., "bolt://localhost:7687" or "neo4j+s://xxx.databases.neo4j.io")
        :param user: Database username
        :param password: Database password
        :param max_connection_lifetime: Maximum connection lifetime in seconds (default: 3600)
        :raises ValueError: If required parameters are empty
        """
        if not all([uri, user, password]):
            raise ValueError("URI, user, and password are required parameters")

        self.uri = uri
        self.user = user
        self.password = password
        self.driver = GraphDatabase.driver(
            self.uri,
            auth=(self.user, self.password),
            max_connection_lifetime=max_connection_lifetime
        )

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit - ensures connection is closed."""
        self.close()
        return False

    def close(self):
        """Close connection to Neo4j."""
        if self.driver:
            self.driver.close()

    def execute_query(self, query: str, parameters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """
        Execute a Cypher query and return results.

        :param query: Cypher query to execute
        :param parameters: Query parameters dictionary (optional) - USE THIS to prevent injection
        :return: List of results as dictionaries
        :raises ValueError: If query is empty
        :raises Exception: If query execution fails
        """
        if not query or not query.strip():
            raise ValueError("Query cannot be empty")

        parameters = parameters or {}

        try:
            with self.driver.session() as session:
                result = session.run(query, parameters)
                return [record.data() for record in result]
        except Exception as e:
            raise Exception(f"Failed to execute Neo4j query: {str(e)}") from e
