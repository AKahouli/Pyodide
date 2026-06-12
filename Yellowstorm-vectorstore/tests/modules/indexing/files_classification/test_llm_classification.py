"""
Unit tests for LLM-only classification module.
"""
import json
from unittest.mock import Mock, patch, MagicMock
import pytest
from types import SimpleNamespace


class TestDocumentClassifier:
    """Tests for DocumentClassifier with LLM-only approach."""

    @pytest.fixture
    def sample_directories(self):
        """Directory structure for tests."""
        return [
            {
                "id": "dir_1",
                "directory": "documents",
                "sous_directories": [
                    {"id": "dir_2", "directory": "legal", "sous_directories": []},
                    {"id": "dir_3", "directory": "hr", "sous_directories": []},
                ],
            },
            {
                "id": "dir_4",
                "directory": "images",
                "sous_directories": [
                    {"id": "dir_5", "directory": "photos", "sous_directories": []},
                    {"id": "dir_6", "directory": "diagrams", "sous_directories": []},
                ],
            },
        ]

    @pytest.fixture
    def mock_qdrant_client(self):
        """Mock Qdrant client."""
        mock_client = MagicMock()
        mock_point = MagicMock()
        mock_point.id = "chunk_1"
        mock_point.payload = {
            "content": "This is a legal document about contracts",
            "title": "Contract Document",
            "metadata": {"page": 1, "chunk_order": 0},
        }
        mock_client.scroll.return_value = ([mock_point], None)
        return mock_client

    @pytest.fixture
    def mock_settings(self):
        """Mock configuration settings."""
        with patch('src.modules.indexing.files_classification.similarity_classification.get_settings') as mock:
            mock_settings = Mock()
            mock_settings.LITELLM_API_KEY = "test_key"
            mock_settings.LITELLM_BASE_URL = "https://test.api.com"
            mock_settings.LLM_CLASSIFICATION_MODEL = "gpt-4"
            mock.return_value = mock_settings
            yield mock_settings

    def test_classifier_initialization(self, sample_directories, mock_qdrant_client):
        """Test classifier initialization."""
        with patch('src.modules.indexing.files_classification.similarity_classification.get_qdrant_client', return_value=mock_qdrant_client):
            from src.modules.indexing.files_classification.similarity_classification import DocumentClassifier

            classifier = DocumentClassifier(
                index_name="test_index",
                directories=sample_directories,
                external_id="test_doc",
                username="test_user",
            )

            assert classifier.external_id == "test_doc"
            assert classifier.username == "test_user"
            assert classifier.index_name == "test_index"
            assert len(classifier.directories) == 2

    def test_classifier_initialization_empty_directories(self, mock_qdrant_client):
        """Test initialization with empty directories."""
        with patch('src.modules.indexing.files_classification.similarity_classification.get_qdrant_client', return_value=mock_qdrant_client):
            from src.modules.indexing.files_classification.similarity_classification import DocumentClassifier

            classifier = DocumentClassifier(
                index_name="test_index",
                directories=[],
                external_id="test_doc",
                username="test_user",
            )

            assert classifier.directories == []
            assert classifier._build_category_list_for_prompt().startswith("No predefined categories")

    def test_extract_paths(self, sample_directories, mock_qdrant_client):
        """Test path extraction from structure."""
        with patch('src.modules.indexing.files_classification.similarity_classification.get_qdrant_client', return_value=mock_qdrant_client):
            from src.modules.indexing.files_classification.similarity_classification import DocumentClassifier

            classifier = DocumentClassifier(
                index_name="test_index",
                directories=sample_directories,
                external_id="test_doc",
                username="test_user",
            )

            paths = classifier.extract_paths(sample_directories)
            assert "documents" in paths
            assert "documents/legal" in paths
            assert "documents/hr" in paths
            assert "images" in paths
            assert "images/photos" in paths

    def test_build_category_list_for_prompt(self, sample_directories, mock_qdrant_client):
        """Test category list building for LLM prompt."""
        with patch('src.modules.indexing.files_classification.similarity_classification.get_qdrant_client', return_value=mock_qdrant_client):
            from src.modules.indexing.files_classification.similarity_classification import DocumentClassifier

            classifier = DocumentClassifier(
                index_name="test_index",
                directories=sample_directories,
                external_id="test_doc",
                username="test_user",
            )

            category_list = classifier._build_category_list_for_prompt()
            assert "documents (ID: dir_1)" in category_list
            assert "legal (ID: dir_2)" in category_list
            assert "hr (ID: dir_3)" in category_list
            assert "images (ID: dir_4)" in category_list

    def test_classify_chunks_with_qdrant_empty_ids(self, sample_directories, mock_qdrant_client):
        """Test classification with empty ids list."""
        with patch('src.modules.indexing.files_classification.similarity_classification.get_qdrant_client', return_value=mock_qdrant_client):
            from src.modules.indexing.files_classification.similarity_classification import DocumentClassifier

            classifier = DocumentClassifier(
                index_name="test_index",
                directories=sample_directories,
                external_id="test_doc",
                username="test_user",
            )

            with pytest.raises(ValueError, match="La liste des IDs ne peut pas"):
                classifier.classify_chunks_with_qdrant([], False)

    @patch('src.modules.indexing.files_classification.similarity_classification.OpenAI')
    def test_classify_chunks_with_qdrant_llm_success(self, mock_openai, sample_directories, mock_qdrant_client):
        """Test successful LLM classification."""
        with patch('src.modules.indexing.files_classification.similarity_classification.get_qdrant_client', return_value=mock_qdrant_client):
            from src.modules.indexing.files_classification.similarity_classification import DocumentClassifier

            mock_response = {
                "predicted_category": "legal",
                "is_new_category": False,
                "confidence": 0.85,
                "reasoning": "The document contains legal terminology and contract language",
                "matched_existing_id": "dir_2",
            }

            mock_client = Mock()
            mock_openai.return_value = mock_client
            mock_completion = Mock()
            mock_completion.choices = [Mock()]
            mock_completion.choices[0].message = Mock()
            mock_completion.choices[0].message.content = json.dumps(mock_response)
            mock_client.chat.completions.create.return_value = mock_completion

            classifier = DocumentClassifier(
                index_name="test_index",
                directories=sample_directories,
                external_id="test_doc",
                username="test_user",
            )

            result = classifier.classify_chunks_with_qdrant(["chunk_1"], False)

            assert result is not None
            assert result["predicted_category"] == "legal"
            assert result["is_new_category"] is False
            assert result["category_id"] == "dir_2"
            assert result["classification_source"] == "llm_existing"
            assert result["final_confidence"] == pytest.approx(0.85)
            assert "reasoning" in result

    @patch('src.modules.indexing.files_classification.similarity_classification.OpenAI')
    def test_classify_chunks_with_qdrant_llm_new_category(self, mock_openai, sample_directories, mock_qdrant_client):
        """Test LLM classification with new category."""
        with patch('src.modules.indexing.files_classification.similarity_classification.get_qdrant_client', return_value=mock_qdrant_client):
            from src.modules.indexing.files_classification.similarity_classification import DocumentClassifier

            mock_response = {
                "predicted_category": "marketing",
                "is_new_category": True,
                "confidence": 0.92,
                "reasoning": "This document discusses marketing strategies which doesn't match existing categories",
                "matched_existing_id": None,
            }

            mock_client = Mock()
            mock_openai.return_value = mock_client
            mock_completion = Mock()
            mock_completion.choices = [Mock()]
            mock_completion.choices[0].message = Mock()
            mock_completion.choices[0].message.content = json.dumps(mock_response)
            mock_client.chat.completions.create.return_value = mock_completion

            classifier = DocumentClassifier(
                index_name="test_index",
                directories=sample_directories,
                external_id="test_doc",
                username="test_user",
            )

            result = classifier.classify_chunks_with_qdrant(["chunk_1"], False)

            assert result is not None
            assert result["predicted_category"] == "marketing"
            assert result["is_new_category"] is True
            assert result["category_id"] is None
            assert result["classification_source"] == "llm_new"
            assert result["final_confidence"] == pytest.approx(0.92)

    @patch('src.modules.indexing.files_classification.similarity_classification.OpenAI')
    def test_classify_chunks_with_qdrant_llm_error(self, mock_openai, sample_directories, mock_qdrant_client):
        """Test LLM error handling."""
        with patch('src.modules.indexing.files_classification.similarity_classification.get_qdrant_client', return_value=mock_qdrant_client):
            from src.modules.indexing.files_classification.similarity_classification import DocumentClassifier

            mock_client = Mock()
            mock_openai.return_value = mock_client
            mock_client.chat.completions.create.side_effect = Exception("LLM API error")

            classifier = DocumentClassifier(
                index_name="test_index",
                directories=sample_directories,
                external_id="test_doc",
                username="test_user",
            )

            result = classifier.classify_chunks_with_qdrant(["chunk_1"], False)

            assert result is not None
            assert result["predicted_category"] == "Autres"
            assert result["is_new_category"] is False
            assert result["classification_source"] == "llm_existing"
            assert result["final_confidence"] == pytest.approx(0.0)

    def test_classify_document_by_external_id(self, sample_directories, mock_qdrant_client):
        """Test classification by external_id."""
        with patch('src.modules.indexing.files_classification.similarity_classification.get_qdrant_client', return_value=mock_qdrant_client):
            from src.modules.indexing.files_classification.similarity_classification import DocumentClassifier

            classifier = DocumentClassifier(
                index_name="test_index",
                directories=sample_directories,
                external_id="test_doc",
                username="test_user",
            )

            classifier.chunk_retrieval_service.get_chunks_content_by_external_id = Mock(return_value={
                "chunk_1": {"content": "test content", "metadata": {}}
            })

            with patch.object(classifier, '_classify_chunks_data') as mock_classify:
                mock_classify.return_value = {
                    "predicted_category": "legal",
                    "is_new_category": False,
                    "category_id": "dir_2",
                    "classification_source": "llm_existing",
                    "final_confidence": 0.85,
                }

                result = classifier.classify_document_by_external_id(include_images=False)

                assert result["predicted_category"] == "legal"
                classifier.chunk_retrieval_service.get_chunks_content_by_external_id.assert_called_once_with(
                    "test_doc",
                    False,
                    None,
                    None,
                )
                mock_classify.assert_called_once()


class TestCategoryValidation:
    """Tests for category validation function."""

    def test_validate_existing_category(self):
        """Test validation of existing category."""
        from src.helpers.classification_helpers import validate_and_normalize_category
        structure_template = [
            {"id": "dir_1", "directory": "documents", "sous_directories": []},
            {"id": "dir_2", "directory": "images", "sous_directories": []},
        ]

        is_existing, normalized_name, category_id = validate_and_normalize_category(
            "documents", structure_template
        )

        assert is_existing is True
        assert normalized_name == "documents"
        assert category_id == "dir_1"

    def test_validate_nonexistent_category(self):
        """Test validation of non-existent category."""
        from src.helpers.classification_helpers import validate_and_normalize_category
        structure_template = [
            {"id": "dir_1", "directory": "documents", "sous_directories": []}
        ]

        is_existing, normalized_name, category_id = validate_and_normalize_category(
            "marketing", structure_template
        )

        assert is_existing is False
        assert normalized_name == "marketing"
        assert category_id is None

    def test_validate_nested_category(self):
        """Test validation of nested category."""
        from src.helpers.classification_helpers import validate_and_normalize_category
        structure_template = [
            {
                "id": "dir_1",
                "directory": "documents",
                "sous_directories": [
                    {"id": "dir_2", "directory": "legal", "sous_directories": []}
                ],
            }
        ]

        is_existing, normalized_name, category_id = validate_and_normalize_category(
            "legal", structure_template
        )

        assert is_existing is True
        assert normalized_name == "legal"
        assert category_id == "dir_2"

    def test_validate_case_insensitive(self):
        """Test case-insensitive validation."""
        from src.helpers.classification_helpers import validate_and_normalize_category
        structure_template = [
            {"id": "dir_1", "directory": "Documents", "sous_directories": []}
        ]

        is_existing, normalized_name, category_id = validate_and_normalize_category(
            "documents", structure_template
        )

        assert is_existing is True
        assert normalized_name == "Documents"
        assert category_id == "dir_1"


class TestLLMClassificationDirect:
    """Tests for _classify_with_llm_direct."""

    @patch('src.helpers.classification_helpers.validate_and_normalize_category')
    def test_classify_with_llm_direct_existing_category(self, mock_validate):
        """Test LLM direct classification with existing category."""
        from src.helpers.classification_helpers import _classify_with_llm_direct

        mock_validate.return_value = (True, "documents/legal", "dir_2")

        classifier = Mock()
        classifier.classify_document_by_external_id.return_value = {
            "predicted_category": "documents/legal",
            "confidence": "high",
            "reasoning": "Legal document detected",
        }

        result = _classify_with_llm_direct(
            classifier=classifier,
            external_id="test_doc",
            structure_template=[],
            include_images=False,
            chunk_filter=None,
            sheet_name=None,
            vectorstore_name="test_index",
            username="test_user",
        )

        assert result["predicted_category"] == "documents/legal"
        assert result["is_existing_category"] is True
        assert result["category_id"] == "dir_2"
        assert result["classification_source"] == "llm_existing"

    @patch('src.helpers.classification_helpers.validate_and_normalize_category')
    def test_classify_with_llm_direct_new_category(self, mock_validate):
        """Test LLM direct classification with new category."""
        from src.helpers.classification_helpers import _classify_with_llm_direct

        mock_validate.return_value = (False, "marketing", None)

        classifier = Mock()
        classifier.classify_document_by_external_id.return_value = {
            "predicted_category": "marketing",
            "confidence": "high",
            "reasoning": "Marketing document detected",
        }

        result = _classify_with_llm_direct(
            classifier=classifier,
            external_id="test_doc",
            structure_template=[],
            include_images=False,
            chunk_filter=None,
            sheet_name=None,
            vectorstore_name="test_index",
            username="test_user",
        )

        assert result["predicted_category"] == "marketing"
        assert result["is_existing_category"] is False
        assert result["category_id"] is None
        assert result["classification_source"] == "llm_new"

    def test_classify_with_llm_direct_error(self):
        """Test error handling in LLM direct classification."""
        from src.helpers.classification_helpers import _classify_with_llm_direct

        classifier = Mock()
        classifier.classify_document_by_external_id.side_effect = Exception("Classification failed")

        with pytest.raises(Exception, match="Classification failed"):
            _classify_with_llm_direct(
                classifier=classifier,
                external_id="test_doc",
                structure_template=[],
                include_images=False,
                chunk_filter=None,
                sheet_name=None,
                vectorstore_name="test_index",
                username="test_user",
            )


class TestLLMStructuredOutput:
    """Tests for LLM structured output validation."""

    def test_parse_valid_llm_response(self):
        """Test parsing a valid LLM response."""
        json_response = json.dumps(
            {
                "predicted_category": "documents/legal",
                "is_new_category": False,
                "confidence": 0.85,
                "reasoning": "Legal document detected",
                "matched_existing_id": "dir_2",
            }
        )

        parsed = json.loads(json_response)
        assert parsed["predicted_category"] == "documents/legal"
        assert parsed["is_new_category"] is False
        assert parsed["confidence"] == pytest.approx(0.85)
        assert parsed["matched_existing_id"] == "dir_2"

    def test_parse_llm_response_missing_fields(self):
        """Test parsing an LLM response with missing fields."""
        json_response = json.dumps(
            {"predicted_category": "documents/legal", "confidence": 0.85}
        )

        parsed = json.loads(json_response)
        assert "predicted_category" in parsed
        assert "confidence" in parsed

    def test_parse_llm_response_invalid_json(self):
        """Test parsing invalid JSON response."""
        invalid_json = '{"predicted_category": "documents/legal", "confidence":}'

        with pytest.raises(json.JSONDecodeError):
            json.loads(invalid_json)
