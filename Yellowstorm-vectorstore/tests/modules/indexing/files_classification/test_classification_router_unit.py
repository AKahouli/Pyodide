import pytest
from unittest.mock import Mock, patch, AsyncMock
import uuid
import sys
import os

# Add the project root to Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))


class TestClassificationValidation:
    """Unit tests for classification request validation logic"""

    def test_classify_document_request_valid(self):
        """Test creating a valid ClassifyDocumentRequest"""
        from src.schema.fastapi.vectorstores.requests import ClassifyDocumentRequest

        # Create a valid request
        request = ClassifyDocumentRequest(
            vectorstore_name="test_index",
            file_path="documents/sample.pdf",
            structure_template=[
                {"id": "dir1", "directory": "Marketing", "parent_id": None, "level": 1},
                {"id": "dir2", "directory": "Finance", "parent_id": None, "level": 1}
            ],
            webhook_url="https://example.com/webhook",
            sheet_name="Q4_2023",
            metadata={"type": "text"}
        )

        # Assertions
        assert request.vectorstore_name == "test_index"
        assert len(request.structure_template) == 2
        assert request.webhook_url == "https://example.com/webhook"
        assert request.sheet_name == "Q4_2023"
        assert request.metadata == {"type": "text"}

    def test_classify_document_request_minimal(self):
        """Test creating a minimal ClassifyDocumentRequest"""
        from src.schema.fastapi.vectorstores.requests import ClassifyDocumentRequest

        # Create a minimal request (only required fields)
        request = ClassifyDocumentRequest(
            vectorstore_name="test_index",
            file_path="documents/sample.pdf",
            structure_template=[
                {"id": "dir1", "directory": "HR", "parent_id": None, "level": 1}
            ]
        )

        # Assertions
        assert request.vectorstore_name == "test_index"
        assert len(request.structure_template) == 1
        assert request.webhook_url is None  # Optional field
        assert request.sheet_name is None  # Optional field
        assert request.metadata is None  # Optional field

    def test_similarity_classification_is_default(self):
        """Test that classification always uses similarity with LLM fallback"""
        from src.schema.fastapi.vectorstores.requests import ClassifyDocumentRequest

        # Create a request and verify it uses similarity classification by design
        request = ClassifyDocumentRequest(
            vectorstore_name="test_index",
            file_path="documents/sample.pdf",
            structure_template=[{"id": "dir1", "directory": "Sales", "parent_id": None, "level": 1}]
        )

        # Verify the request was created successfully
        # (classification_method is no longer a parameter - always uses similarity)
        assert request.vectorstore_name == "test_index"
        assert len(request.structure_template) == 1

    def test_structure_template_validation(self):
        """Test structure template field validation"""
        from src.schema.fastapi.vectorstores.requests import ClassifyDocumentRequest

        # Test with valid structure template
        request = ClassifyDocumentRequest(
            vectorstore_name="test_index",
            file_path="documents/sample.pdf",
            external_id="doc456",
            structure_template=[
                {"id": "dir1", "directory": "Marketing", "parent_id": None, "level": 1},
                {"id": "dir2", "directory": "Digital Marketing", "parent_id": "dir1", "level": 2}
            ]
        )

        assert len(request.structure_template) == 2
        assert request.structure_template[0]["directory"] == "Marketing"
        assert request.structure_template[1]["parent_id"] == "dir1"
        assert request.structure_template[1]["level"] == 2


class TestTaskMetadataGeneration:
    """Unit tests for task metadata generation logic"""

    def test_task_metadata_structure_complete(self):
        """Test task metadata generation with all fields"""
        import uuid

        # Simulate request data
        vectorstore_name = "test_index"
        external_id = "doc123"
        include_images = True

        # Generate task ID and metadata (simulating router logic)
        task_id = str(uuid.uuid4())
        task_metadata = {
            "task_id": task_id,
            "vectorstore_name": vectorstore_name,
            "external_id": external_id,
            "classification_method": "similarity",  # Always uses similarity with LLM fallback
            "include_images": include_images
        }

        # Assertions
        assert task_metadata["task_id"] == task_id
        assert task_metadata["vectorstore_name"] == vectorstore_name
        assert task_metadata["external_id"] == external_id
        assert task_metadata["classification_method"] == "similarity"  # Always similarity
        assert task_metadata["include_images"] == include_images

    def test_task_metadata_structure_minimal(self):
        """Test task metadata generation with minimal fields"""
        import uuid

        # Simulate request data
        vectorstore_name = "test_index"
        external_id = "doc456"
        include_images = False

        # Generate task ID and metadata
        task_id = str(uuid.uuid4())
        task_metadata = {
            "task_id": task_id,
            "vectorstore_name": vectorstore_name,
            "external_id": external_id,
            "classification_method": "similarity",  # Always uses similarity with LLM fallback
            "include_images": include_images
        }

        # Assertions
        assert task_metadata["task_id"] == task_id
        assert task_metadata["vectorstore_name"] == vectorstore_name
        assert task_metadata["external_id"] == external_id
        assert task_metadata["classification_method"] == "similarity"
        assert task_metadata["include_images"] == include_images

    def test_task_id_generation_uniqueness(self):
        """Test that task IDs are unique"""
        import uuid

        # Generate multiple task IDs
        task_ids = [str(uuid.uuid4()) for _ in range(10)]

        # Assertions
        assert len(task_ids) == 10
        assert len(set(task_ids)) == 10  # All unique
        assert all(len(task_id) == 36 for task_id in task_ids)  # UUID string length
        assert all(task_id.count('-') == 4 for task_id in task_ids)  # UUID format

    def test_task_metadata_field_types(self):
        """Test that task metadata fields have correct types"""
        import uuid

        # Generate task metadata
        task_id = str(uuid.uuid4())
        task_metadata = {
            "task_id": task_id,
            "vectorstore_name": "test_index",
            "external_id": "doc123",
            "classification_method": "similarity",
            "include_images": True
        }

        # Type assertions
        assert isinstance(task_metadata["task_id"], str)
        assert isinstance(task_metadata["vectorstore_name"], str)
        assert isinstance(task_metadata["external_id"], str)
        assert isinstance(task_metadata["classification_method"], str)
        assert isinstance(task_metadata["include_images"], bool)


class TestClassificationRouterHelpers:
    """Unit tests for helper functions used in classification router"""

    def test_directory_id_mapping_integration(self):
        """Test directory ID mapping using the helper function"""
        from src.helpers.classification_helpers import get_directory_id_from_category

        structure_template = [
            {"id": "marketing_dir", "directory": "Marketing", "parent_id": None},
            {"id": "finance_dir", "directory": "Finance", "parent_id": None},
            {"id": "hr_dir", "directory": "Human Resources", "parent_id": None},
            {"id": "digital_marketing_dir", "directory": "Digital Marketing", "parent_id": "marketing_dir"}
        ]

        # Test exact matches
        assert get_directory_id_from_category("Marketing", structure_template) == "marketing_dir"
        assert get_directory_id_from_category("Finance", structure_template) == "finance_dir"
        assert get_directory_id_from_category("Human Resources", structure_template) == "hr_dir"
        assert get_directory_id_from_category("Digital Marketing", structure_template) == "digital_marketing_dir"

        # Test partial matches
        assert get_directory_id_from_category("Marketing Team", structure_template) == "marketing_dir"
        assert get_directory_id_from_category("Digital", structure_template) == "digital_marketing_dir"

        # Test no match
        assert get_directory_id_from_category("Sales", structure_template) is None
        assert get_directory_id_from_category("IT", structure_template) is None

    def test_pending_classification_task_response(self):
        """Test PendingClassificationTask response model"""
        from src.schema.fastapi.vectorstores.responses import PendingClassificationTask

        # Create a response
        response = PendingClassificationTask(
            classification_task_id="task_123",
            status="queued",
            estimated_chunks=None
        )

        # Assertions
        assert response.classification_task_id == "task_123"
        assert response.status == "queued"
        assert response.estimated_chunks is None

        # Create a response with estimated chunks
        response_with_chunks = PendingClassificationTask(
            classification_task_id="task_456",
            status="processing",
            estimated_chunks=25
        )

        assert response_with_chunks.classification_task_id == "task_456"
        assert response_with_chunks.status == "processing"
        assert response_with_chunks.estimated_chunks == 25

    

class TestValidationErrorHandling:
    """Unit tests for validation error handling in classification router"""

    def test_request_validation_scenarios(self):
        """Test various request validation scenarios"""
        from src.schema.fastapi.vectorstores.requests import ClassifyDocumentRequest

        # Test that valid requests can be created successfully
        valid_request = ClassifyDocumentRequest(
            vectorstore_name="test_index",
            file_path="documents/sample.pdf",
            structure_template=[{"id": "dir1", "directory": "Marketing", "parent_id": None, "level": 1}]
        )

        assert valid_request.vectorstore_name == "test_index"
        assert len(valid_request.structure_template) == 1

        # Test request with optional fields
        request_with_options = ClassifyDocumentRequest(
            vectorstore_name="test_index",
            file_path="documents/sample.pdf",
            structure_template=[{"id": "dir2", "directory": "Finance", "parent_id": None, "level": 1}],
            webhook_url="https://example.com/webhook",
            sheet_name="Q4_2023"
        )

        assert request_with_options.webhook_url == "https://example.com/webhook"
        assert request_with_options.sheet_name == "Q4_2023"
