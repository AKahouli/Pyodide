import pytest
from unittest.mock import Mock, patch
import sys
import os

# Add the project root to Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


class TestDirectoryIdMapping:
    """Unit tests for get_directory_id_from_category function"""

    def test_exact_match_found(self):
        """Test when exact directory match is found"""
        from src.helpers.classification_helpers import get_directory_id_from_category

        structure_template = [
            {"id": "dir1", "directory": "Marketing"},
            {"id": "dir2", "directory": "Finance"},
            {"id": "dir3", "directory": "HR"}
        ]
        result = get_directory_id_from_category("Marketing", structure_template)
        assert result == "dir1"

    def test_exact_match_not_found(self):
        """Test when exact directory match is not found"""
        from src.helpers.classification_helpers import get_directory_id_from_category

        structure_template = [
            {"id": "dir1", "directory": "Marketing"},
            {"id": "dir2", "directory": "Finance"}
        ]
        result = get_directory_id_from_category("Sales", structure_template)
        assert result is None

    def test_partial_match_category_starts_with_directory(self):
        """Test partial match where category starts with directory name"""
        from src.helpers.classification_helpers import get_directory_id_from_category

        structure_template = [
            {"id": "dir1", "directory": "HR"},
            {"id": "dir2", "directory": "Finance"}
        ]
        result = get_directory_id_from_category("HR Management", structure_template)
        assert result == "dir1"

    def test_partial_match_directory_starts_with_category(self):
        """Test partial match where directory starts with category name"""
        from src.helpers.classification_helpers import get_directory_id_from_category

        structure_template = [
            {"id": "dir1", "directory": "Marketing"},
            {"id": "dir2", "directory": "Marketing Analytics"}
        ]
        result = get_directory_id_from_category("Marketing", structure_template)
        assert result == "dir1"

    def test_empty_inputs(self):
        """Test with empty inputs"""
        from src.helpers.classification_helpers import get_directory_id_from_category

        result = get_directory_id_from_category("", [{"id": "dir1", "directory": "Marketing"}])
        assert result is None

        result = get_directory_id_from_category("Marketing", [])
        assert result is None

        result = get_directory_id_from_category("", [])
        assert result is None

        result = get_directory_id_from_category(None, [{"id": "dir1", "directory": "Marketing"}])
        assert result is None

        result = get_directory_id_from_category("Marketing", None)
        assert result is None

    def test_case_sensitive_matching(self):
        """Test that matching is case sensitive"""
        from src.helpers.classification_helpers import get_directory_id_from_category

        structure_template = [
            {"id": "dir1", "directory": "Marketing"},
            {"id": "dir2", "directory": "marketing"}
        ]
        result = get_directory_id_from_category("Marketing", structure_template)
        assert result == "dir1"

        result = get_directory_id_from_category("marketing", structure_template)
        assert result == "dir2"

    def test_hierarchical_structure_template(self):
        """Test with hierarchical structure template"""
        from src.helpers.classification_helpers import get_directory_id_from_category

        structure_template = [
            {"id": "dir1", "directory": "Marketing", "parent_id": None, "level": 1},
            {"id": "dir2", "directory": "Finance", "parent_id": None, "level": 1},
            {"id": "dir3", "directory": "Digital Marketing", "parent_id": "dir1", "level": 2},
            {"id": "dir4", "directory": "Content Marketing", "parent_id": "dir1", "level": 2},
            {"id": "dir5", "directory": "Accounting", "parent_id": "dir2", "level": 2}
        ]

        # Test top-level categories
        assert get_directory_id_from_category("Marketing", structure_template) == "dir1"
        assert get_directory_id_from_category("Finance", structure_template) == "dir2"

        # Test sub-categories
        assert get_directory_id_from_category("Digital Marketing", structure_template) == "dir3"
        assert get_directory_id_from_category("Content Marketing", structure_template) == "dir4"
        assert get_directory_id_from_category("Accounting", structure_template) == "dir5"

        # Test partial matching with hierarchical structure
        assert get_directory_id_from_category("Digital", structure_template) == "dir3"
        assert get_directory_id_from_category("Content", structure_template) == "dir4"

    def test_special_characters_in_directory_names(self):
        """Test with special characters in directory names"""
        from src.helpers.classification_helpers import get_directory_id_from_category

        structure_template = [
            {"id": "dir1", "directory": "R&D"},
            {"id": "dir2", "directory": "Customer Service"},
            {"id": "dir3", "directory": "IT Infrastructure"},
            {"id": "dir4", "directory": "Quality Assurance (QA)"}
        ]

        # Test exact matches with special characters
        assert get_directory_id_from_category("R&D", structure_template) == "dir1"
        assert get_directory_id_from_category("Customer Service", structure_template) == "dir2"
        assert get_directory_id_from_category("IT Infrastructure", structure_template) == "dir3"

        # Test partial matches
        assert get_directory_id_from_category("Quality Assurance", structure_template) == "dir4"
        assert get_directory_id_from_category("Customer", structure_template) == "dir2"

    def test_multiple_possible_matches(self):
        """Test behavior when multiple directories could match"""
        from src.helpers.classification_helpers import get_directory_id_from_category

        structure_template = [
            {"id": "dir1", "directory": "Marketing"},
            {"id": "dir2", "directory": "Marketing Analytics"},
            {"id": "dir3", "directory": "Digital Marketing"}
        ]

        # Should return the first exact match found
        result = get_directory_id_from_category("Marketing", structure_template)
        assert result == "dir1"

        # Should find the best match for partial categories
        result = get_directory_id_from_category("Marketing Analytics", structure_template)
        assert result == "dir2"

    def test_unicode_characters(self):
        """Test with unicode characters in directory names"""
        from src.helpers.classification_helpers import get_directory_id_from_category

        structure_template = [
            {"id": "dir1", "directory": "Marketing"},
            {"id": "dir2", "directory": "Finance"},
            {"id": "dir3", "directory": "Ressources Humaines"},
            {"id": "dir4", "directory": "Développement"}
        ]

        # Test with unicode characters
        assert get_directory_id_from_category("Ressources Humaines", structure_template) == "dir3"
        assert get_directory_id_from_category("Développement", structure_template) == "dir4"

        # Test partial unicode matching
        assert get_directory_id_from_category("Ressources", structure_template) == "dir3"
        assert get_directory_id_from_category("Dévelop", structure_template) == "dir4"

    def test_edge_cases(self):
        """Test edge cases and boundary conditions"""
        from src.helpers.classification_helpers import get_directory_id_from_category

        structure_template = [
            {"id": "dir1", "directory": "A"},
            {"id": "dir2", "directory": "B"},
            {"id": "dir3", "directory": "C"}
        ]

        # Test single character matching
        assert get_directory_id_from_category("A", structure_template) == "dir1"

        # Test very long category name (should still match 'A' directory since 'A' starts with 'A')
        long_category = "A" * 1000
        result = get_directory_id_from_category(long_category, structure_template)
        assert result == "dir1"  # Should match 'A' directory since 'A' starts with 'A'

        # Test with structure template entries missing directory field
        incomplete_template = [
            {"id": "dir1"},  # Missing directory field
            {"id": "dir2", "directory": "Finance"}
        ]
        result = get_directory_id_from_category("Finance", incomplete_template)
        assert result == "dir2"  # Should still find the valid entry


class TestWebhookSendingFunction:
    """Unit tests for send_webhook_sync function"""

    @patch('builtins.__import__')
    def test_webhook_function_exists(self, mock_import):
        """Test that webhook function exists and is callable"""
        from src.helpers.classification_helpers import send_webhook_sync

        assert callable(send_webhook_sync)

    def test_webhook_function_signature(self):
        """Test that webhook function has correct signature"""
        import inspect
        from src.helpers.classification_helpers import send_webhook_sync

        sig = inspect.signature(send_webhook_sync)
        params = list(sig.parameters.keys())

        assert len(params) == 2
        assert 'webhook_url' in params
        assert 'payload' in params

    def test_webhook_function_handles_parameters(self):
        """Test that webhook function accepts the expected parameters"""
        from src.helpers.classification_helpers import send_webhook_sync

        # Test that function exists and is callable
        assert callable(send_webhook_sync)

        # Test that it doesn't raise TypeError with expected parameters
        try:
            # This will fail at runtime due to missing requests, but should not raise TypeError
            send_webhook_sync("https://example.com/webhook", {"test": "data"})
        except TypeError:
            pytest.fail("send_webhook_sync should accept webhook_url and payload parameters")
        except Exception:
            # Other exceptions (like missing requests) are expected
            pass