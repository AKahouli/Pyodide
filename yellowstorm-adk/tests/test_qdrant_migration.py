#!/usr/bin/env python3
"""
Test script to verify Qdrant migration is working correctly.

This script tests:
1. Qdrant connection
2. Vector similarity search
3. Hybrid search
4. Multilingual search
5. Filter functionality
6. Result structure validation

Usage:
    python test_qdrant_migration.py

Requirements:
    - Qdrant server must be running
    - .env file must be configured with Qdrant credentials
    - At least one collection must exist with documents
"""

import os
import sys
import pytest
from typing import List, Dict, Any
from dotenv import load_dotenv

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.config.settings import get_settings
from src.logger.logging import get_logger
from src.similarity_search import (
    vector_search_with_score,
    vector_search_with_relevance_scores,
    hybrid_search_with_score,
    vector_search_with_score_multilangue,
    hybrid_search_with_score_multilangue,
)

# Load environment variables
load_dotenv()

logger = get_logger(__name__)


class Colors:
    """ANSI color codes for terminal output."""
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    BOLD = '\033[1m'
    END = '\033[0m'


def print_header(text: str):
    """Print a formatted header."""
    print(f"\n{Colors.BLUE}{Colors.BOLD}{'=' * 70}{Colors.END}")
    print(f"{Colors.BLUE}{Colors.BOLD}{text.center(70)}{Colors.END}")
    print(f"{Colors.BLUE}{Colors.BOLD}{'=' * 70}{Colors.END}\n")


def print_success(text: str):
    """Print success message."""
    print(f"{Colors.GREEN}✓ {text}{Colors.END}")


def print_error(text: str):
    """Print error message."""
    print(f"{Colors.RED}✗ {text}{Colors.END}")


def print_info(text: str):
    """Print info message."""
    print(f"{Colors.YELLOW}ℹ {text}{Colors.END}")


def validate_settings() -> bool:
    """Validate that required Qdrant settings are configured."""
    print_header("Validating Configuration")

    settings = get_settings()

    errors = []

    if not settings.QDRANT_URL:
        errors.append("QDRANT_URL is not set in environment variables")
    else:
        print_success(f"QDRANT_URL: {settings.QDRANT_URL}")

    if not settings.QDRANT_API_KEY:
        errors.append("QDRANT_API_KEY is not set in environment variables")
    else:
        print_success(f"QDRANT_API_KEY: {'*' * 10}{settings.QDRANT_API_KEY[-4:]}")

    if not settings.QDRANT_COLLECTION_NAME:
        errors.append("QDRANT_COLLECTION_NAME is not set in environment variables")
    else:
        print_success(f"QDRANT_COLLECTION_NAME: {settings.QDRANT_COLLECTION_NAME}")

    if not settings.EMBEDDING_MODEL:
        errors.append("EMBEDDING_MODEL is not set in environment variables")
    else:
        print_success(f"EMBEDDING_MODEL: {settings.EMBEDDING_MODEL}")

    if errors:
        print("\nConfiguration errors:")
        for error in errors:
            print_error(error)
        return False

    print_success("\nAll required settings are configured!")
    return True


def test_qdrant_connection() -> bool:
    """Test basic Qdrant connection."""
    print_header("Testing Qdrant Connection")

    try:
        from qdrant_client import QdrantClient
        from src.config.settings import get_settings

        settings = get_settings()

        client = QdrantClient(
            url=settings.QDRANT_URL,
            api_key=settings.QDRANT_API_KEY,
            timeout=10,
        )

        # Test connection by getting collections
        collections = client.get_collections()
        print_success(f"Connected to Qdrant at {settings.QDRANT_URL}")

        collection_names = [col.name for col in collections.collections]
        print_info(f"Available collections: {len(collection_names)}")

        if collection_names:
            print_success(f"Collections: {', '.join(collection_names)}")
        else:
            print_info("No collections found. You may need to index documents first.")

        return True

    except Exception as e:
        print_error(f"Failed to connect to Qdrant: {str(e)}")
        return False


def validate_result_structure(result: tuple) -> bool:
    """Validate that search results have the expected structure."""
    if not isinstance(result, tuple) or len(result) != 2:
        print_error(f"Invalid result format: expected tuple of 2 elements, got {type(result)}")
        return False

    document, score = result

    # Validate document structure
    if not hasattr(document, 'page_content'):
        print_error("Document missing 'page_content' attribute")
        return False

    if not hasattr(document, 'metadata'):
        print_error("Document missing 'metadata' attribute")
        return False

    # Validate score
    if not isinstance(score, (int, float)):
        print_error(f"Invalid score type: expected float, got {type(score)}")
        return False

    return True


@pytest.mark.skip(reason="Integration test requiring external Qdrant server connection")
def test_vector_search(collection_name: str) -> bool:
    """Test vector similarity search."""
    print_header("Testing Vector Similarity Search")

    try:
        query = "test query"
        top_k = 3

        print_info(f"Query: '{query}'")
        print_info(f"Top K: {top_k}")
        print_info(f"Collection: {collection_name}")

        results = vector_search_with_score(
            collection_name=collection_name,
            query=query,
            top_k=top_k,
            user_id="test_user",
        )

        print_success(f"Vector search completed: {len(results)} results returned")

        if results:
            print("\nTop result:")
            doc, score = results[0]
            print(f"  Content: {doc.page_content[:100]}...")
            print(f"  Score: {score:.4f}")
            print(f"  Metadata: {list(doc.metadata.keys())}")

            # Validate structure
            if validate_result_structure(results[0]):
                print_success("Result structure is valid")
            else:
                return False
        else:
            print_info("No results found (collection may be empty)")

        return True

    except Exception as e:
        print_error(f"Vector search failed: {str(e)}")
        import traceback
        print_error(traceback.format_exc())
        return False


@pytest.mark.skip(reason="Integration test requiring external Qdrant server connection")
def test_hybrid_search(collection_name: str) -> bool:
    """Test hybrid search."""
    print_header("Testing Hybrid Search")

    try:
        query = "test query"
        top_k = 3

        print_info(f"Query: '{query}'")
        print_info(f"Top K: {top_k}")
        print_info(f"Collection: {collection_name}")

        results = hybrid_search_with_score(
            collection_name=collection_name,
            query=query,
            top_k=top_k,
            user_id="test_user",
        )

        print_success(f"Hybrid search completed: {len(results)} results returned")

        if results:
            print("\nTop result:")
            doc, score = results[0]
            print(f"  Content: {doc.page_content[:100]}...")
            print(f"  Score: {score:.4f}")
            print(f"  Metadata: {list(doc.metadata.keys())}")

            # Validate structure
            if validate_result_structure(results[0]):
                print_success("Result structure is valid")
            else:
                return False
        else:
            print_info("No results found (collection may be empty)")

        return True

    except Exception as e:
        print_error(f"Hybrid search failed: {str(e)}")
        import traceback
        print_error(traceback.format_exc())
        return False


@pytest.mark.skip(reason="Integration test requiring external Qdrant server connection")
def test_multilingual_search(collection_name: str) -> bool:
    """Test multilingual search."""
    print_header("Testing Multilingual Search")

    try:
        query = "test query"
        top_k = 3

        print_info(f"Query: '{query}'")
        print_info(f"Top K: {top_k}")
        print_info(f"Collection: {collection_name}")

        # Test vector search multilangue
        results = vector_search_with_score_multilangue(
            collection_name=collection_name,
            query=query,
            top_k=top_k,
            user_id="test_user",
        )

        print_success(f"Multilingual vector search completed: {len(results)} results returned")

        if results:
            print("\nTop result:")
            doc, score = results[0]
            print(f"  Content: {doc.page_content[:100]}...")
            print(f"  Score: {score:.4f}")

        # Test hybrid search multilangue
        print("\nTesting multilingual hybrid search...")
        results_hybrid = hybrid_search_with_score_multilangue(
            collection_name=collection_name,
            query=query,
            top_k=top_k,
            user_id="test_user",
        )

        print_success(f"Multilingual hybrid search completed: {len(results_hybrid)} results returned")

        return True

    except Exception as e:
        print_error(f"Multilingual search failed: {str(e)}")
        import traceback
        print_error(traceback.format_exc())
        return False


@pytest.mark.skip(reason="Integration test requiring external Qdrant server connection")
def test_filtered_search(collection_name: str) -> bool:
    """Test search with filters."""
    print_header("Testing Filtered Search")

    try:
        query = "test query"
        top_k = 5
        test_filter = {"brain_id": "test_brain"}  # Adjust based on your data

        print_info(f"Query: '{query}'")
        print_info(f"Filter: {test_filter}")
        print_info(f"Top K: {top_k}")

        results = vector_search_with_score(
            collection_name=collection_name,
            query=query,
            top_k=top_k,
            filter=test_filter,
            user_id="test_user",
        )

        print_success(f"Filtered search completed: {len(results)} results returned")

        if results:
            print(f"\nFound {len(results)} documents matching filter")
            for i, (doc, score) in enumerate(results[:2], 1):
                print(f"  Result {i}:")
                print(f"    Score: {score:.4f}")
                print(f"    Content: {doc.page_content[:80]}...")

        return True

    except Exception as e:
        print_error(f"Filtered search failed: {str(e)}")
        import traceback
        print_error(traceback.format_exc())
        return False


def run_all_tests():
    """Run all tests and report results."""
    print(f"\n{Colors.BOLD}{Colors.BLUE}")
    print("╔═══════════════════════════════════════════════════════════════════╗")
    print("║          QDRANT MIGRATION TEST SUITE                              ║")
    print("╚═══════════════════════════════════════════════════════════════════╝")
    print(f"{Colors.END}")

    test_results = []

    # Test 1: Configuration validation
    test_results.append(("Configuration Validation", validate_settings()))
    if not test_results[-1][1]:
        print_error("\n⚠ Configuration validation failed. Please fix before continuing.")
        return

    # Test 2: Qdrant connection
    test_results.append(("Qdrant Connection", test_qdrant_connection()))

    # Get collection name from settings
    settings = get_settings()
    collection_name = settings.QDRANT_COLLECTION_NAME

    # Test 3: Vector search
    test_results.append(("Vector Search", test_vector_search(collection_name)))

    # Test 4: Hybrid search
    test_results.append(("Hybrid Search", test_hybrid_search(collection_name)))

    # Test 5: Multilingual search
    test_results.append(("Multilingual Search", test_multilingual_search(collection_name)))

    # Test 6: Filtered search
    test_results.append(("Filtered Search", test_filtered_search(collection_name)))

    # Print summary
    print_header("Test Summary")

    passed = sum(1 for _, result in test_results if result)
    total = len(test_results)

    for test_name, result in test_results:
        status = f"{Colors.GREEN}PASS{Colors.END}" if result else f"{Colors.RED}FAIL{Colors.END}"
        print(f"{test_name:.<50} {status}")

    print(f"\n{Colors.BOLD}Results: {passed}/{total} tests passed{Colors.END}")

    if passed == total:
        print(f"\n{Colors.GREEN}{Colors.BOLD}🎉 All tests passed! Qdrant migration is working correctly.{Colors.END}\n")
        return 0
    else:
        print(f"\n{Colors.RED}{Colors.BOLD}⚠ Some tests failed. Please check the errors above.{Colors.END}\n")
        return 1


if __name__ == "__main__":
    exit_code = run_all_tests()
    sys.exit(exit_code)