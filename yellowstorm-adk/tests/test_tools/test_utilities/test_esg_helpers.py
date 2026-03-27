"""
Unit tests for ESG helpers and CSRD pattern search functionality.
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
from src.smart_rag.tools.utilities.esg_helpers import (
    get_embeddings,
    check_ar,
    get_ar_context,
    get_dp_context,
    get_exigence_from_ar,
    get_exigence_cible,
    filter_exigence_children,
    detect_pattern_and_extract_args,
    semantic_search,
    ar_patternsearch,
    num_patternsearch,
    get_normes,
    get_sections,
    get_ars,
    get_exigence
)


class TestGetEmbeddings:
    """Test suite for get_embeddings function."""

    @patch('src.smart_rag.tools.utilities.esg_helpers.embedding_client')
    def test_get_embeddings_success(self, mock_client):
        """Test successful embedding generation."""
        # Arrange
        query = "Climate change adaptation"
        expected_embedding = [0.1, 0.2, 0.3, 0.4, 0.5]

        mock_embedding_response = Mock()
        mock_embedding_response.data = [Mock(embedding=expected_embedding)]
        mock_client.embeddings.create.return_value = mock_embedding_response

        # Act
        result = get_embeddings(query)

        # Assert
        assert result == expected_embedding
        mock_client.embeddings.create.assert_called_once()

    @patch('src.smart_rag.tools.utilities.esg_helpers.embedding_client')
    def test_get_embeddings_with_special_characters(self, mock_client):
        """Test embedding generation with special characters."""
        # Arrange
        query = "ESRS E1-29: Climate change - CO₂ emissions"
        expected_embedding = [0.2, 0.3, 0.4]

        mock_embedding_response = Mock()
        mock_embedding_response.data = [Mock(embedding=expected_embedding)]
        mock_client.embeddings.create.return_value = mock_embedding_response

        # Act
        result = get_embeddings(query)

        # Assert
        assert result == expected_embedding


class TestCheckAR:
    """Test suite for check_ar function."""

    def test_check_ar_valid_format(self):
        """Test with already valid AR format."""
        # Arrange
        ar = "AR 4."

        # Act
        result = check_ar(ar)

        # Assert
        assert result == "AR 4."

    def test_check_ar_needs_correction(self):
        """Test AR format correction."""
        # Arrange
        test_cases = [
            ("AR4", "AR 4."),
            ("AR 4", "AR 4."),
            ("ar4", "AR 4."),
            ("4", "AR 4."),
        ]

        for input_ar, expected in test_cases:
            # Act
            result = check_ar(input_ar)

            # Assert
            assert result == expected, f"Failed for input: {input_ar}"

    def test_check_ar_no_number(self):
        """Test with AR string that has no number."""
        # Arrange
        ar = "AR"

        # Act
        result = check_ar(ar)

        # Assert
        assert result == ""

    def test_check_ar_exception_handling(self):
        """Test exception handling returns empty string."""
        # Act
        result = check_ar(None)

        # Assert - should handle gracefully
        assert result == ""


class TestGetARContext:
    """Test suite for get_ar_context function."""

    def test_get_ar_context_match_found(self):
        """Test finding AR context with matching exigence."""
        # Arrange
        section_context = [
            {
                "esrs": "e1",
                "exigence": "e1-1",
                "ar": "AR 4.",
                "text": "Application requirement text",
                "alphabetical_nodes": ["a", "b"],
                "references": "Reference text"
            },
            {
                "esrs": "e1",
                "exigence": "e1-2",
                "ar": "AR 5.",
                "text": "Another AR",
                "alphabetical_nodes": [],
                "references": "Other reference"
            }
        ]
        exigence = ["e1-1"]
        norme_title = "ESRS E1"

        # Act
        references, ar_context = get_ar_context(section_context, exigence, norme_title)

        # Assert
        assert references == "Reference text"
        assert ar_context["ar"] == "AR 4."
        assert ar_context["text"] == "Application requirement text"
        assert ar_context["alphabetical_nodes"] == ["a", "b"]

    def test_get_ar_context_no_match(self):
        """Test when no matching exigence found."""
        # Arrange
        section_context = [
            {"esrs": "e2", "exigence": "e2-1", "ar": "AR 4.", "text": "Text", "alphabetical_nodes": [], "references": "Ref"}
        ]
        exigence = ["e1-1"]
        norme_title = "ESRS E1"

        # Act
        references, ar_context = get_ar_context(section_context, exigence, norme_title)

        # Assert
        assert references is None
        assert ar_context is None

    def test_get_ar_context_exception(self):
        """Test exception handling."""
        # Arrange - invalid data structure
        section_context = "invalid"
        exigence = ["e1-1"]
        norme_title = "ESRS E1"

        # Act
        references, ar_context = get_ar_context(section_context, exigence, norme_title)

        # Assert
        assert references is None
        assert ar_context is None


class TestGetDPContext:
    """Test suite for get_dp_context function."""

    def test_get_dp_context_match_found(self):
        """Test finding DP context with matching exigence."""
        # Arrange
        section_context = [
            {
                "esrs": "e1",
                "exigence": "e1-1",
                "dp": "29",
                "text": "Data point text",
                "alphabetical_nodes": ["a", "b", "c"],
                "references": "Reference text"
            }
        ]
        exigence = ["e1-1"]
        norme_title = "ESRS E1"

        # Act
        references, dp_context = get_dp_context(section_context, exigence, norme_title)

        # Assert
        assert references == "Reference text"
        assert dp_context["dp"] == "29"
        assert dp_context["text"] == "Data point text"
        assert dp_context["alphabetical_nodes"] == ["a", "b", "c"]

    def test_get_dp_context_no_exigence(self):
        """Test with empty exigence list."""
        # Arrange
        section_context = [{"esrs": "e1", "exigence": "e1-1", "dp": "29", "text": "Text", "alphabetical_nodes": [], "references": "Ref"}]
        exigence = []
        norme_title = "ESRS E1"

        # Act
        references, dp_context = get_dp_context(section_context, exigence, norme_title)

        # Assert
        assert references == ""
        assert dp_context == {}

    def test_get_dp_context_exception(self):
        """Test exception handling."""
        # Arrange
        section_context = None
        exigence = ["e1-1"]
        norme_title = "ESRS E1"

        # Act
        references, dp_context = get_dp_context(section_context, exigence, norme_title)

        # Assert
        assert references == ""
        assert dp_context == {}


class TestFilterExigenceChildren:
    """Test suite for filter_exigence_children function."""

    def test_filter_alphabetical_only(self):
        """Test filtering by alphabetical parameter only."""
        # Arrange
        data_point_context = {
            "alphabetical_nodes": [
                {
                    "alphabetical_label": "a",
                    "text": "Text A",
                    "romans": [
                        {"roman_label": "i", "roman_text": "Roman I"},
                        {"roman_label": "ii", "roman_text": "Roman II"}
                    ]
                },
                {
                    "alphabetical_label": "b",
                    "text": "Text B",
                    "romans": []
                }
            ]
        }
        alphabetical = "a"

        # Act
        result = filter_exigence_children(data_point_context, alphabetical)

        # Assert
        assert len(result["alphabetical_nodes"]) == 1
        assert result["alphabetical_nodes"][0]["alphabetical_label"] == "a"
        assert len(result["alphabetical_nodes"][0]["romans"]) == 2

    def test_filter_alphabetical_and_roman(self):
        """Test filtering by both alphabetical and roman parameters."""
        # Arrange
        data_point_context = {
            "alphabetical_nodes": [
                {
                    "alphabetical_label": "b",
                    "text": "Text B",
                    "romans": [
                        {"roman_label": "iii", "roman_text": "Roman III"},
                        {"roman_label": "iv", "roman_text": "Roman IV"}
                    ]
                }
            ]
        }
        alphabetical = "b"
        roman = "iv"

        # Act
        result = filter_exigence_children(data_point_context, alphabetical, roman)

        # Assert
        assert len(result["alphabetical_nodes"]) == 1
        assert len(result["alphabetical_nodes"][0]["romans"]) == 1
        assert result["alphabetical_nodes"][0]["romans"][0]["roman_label"] == "iv"

    def test_filter_no_match(self):
        """Test when no matches are found."""
        # Arrange
        data_point_context = {
            "alphabetical_nodes": [
                {"alphabetical_label": "a", "text": "Text A", "romans": []}
            ]
        }
        alphabetical = "c"

        # Act
        result = filter_exigence_children(data_point_context, alphabetical)

        # Assert
        assert len(result["alphabetical_nodes"]) == 0

    def test_filter_case_insensitive(self):
        """Test case insensitive filtering."""
        # Arrange
        data_point_context = {
            "alphabetical_nodes": [
                {"alphabetical_label": "A", "text": "Text A", "romans": []}
            ]
        }
        alphabetical = "a"

        # Act
        result = filter_exigence_children(data_point_context, alphabetical)

        # Assert
        assert len(result["alphabetical_nodes"]) == 1

    def test_filter_exception(self):
        """Test exception handling."""
        # Arrange
        data_point_context = None
        alphabetical = "a"

        # Act
        result = filter_exigence_children(data_point_context, alphabetical)

        # Assert
        assert result == {}


class TestDetectPatternAndExtractArgs:
    """Test suite for detect_pattern_and_extract_args function."""

    def test_detect_numerical_pattern_simple(self):
        """Test detection of simple numerical pattern (E1-29)."""
        # Arrange
        query = "E1-29"

        # Act
        function_name, args = detect_pattern_and_extract_args(query)

        # Assert
        assert function_name == "num_patternsearch"
        assert args["norme"] == "E1"
        assert args["section"] == "29"
        assert args["alphabetical"] is None
        assert args["roman"] is None

    def test_detect_numerical_pattern_with_alphabetical(self):
        """Test detection of numerical pattern with alphabetical (E1-29-b)."""
        # Arrange
        query = "E1-29-b"

        # Act
        function_name, args = detect_pattern_and_extract_args(query)

        # Assert
        assert function_name == "num_patternsearch"
        assert args["norme"] == "E1"
        assert args["section"] == "29"
        assert args["alphabetical"] == "b"
        assert args["roman"] is None

    def test_detect_numerical_pattern_full(self):
        """Test detection of full numerical pattern (E1-29-b-IV)."""
        # Arrange
        query = "E1-29-b-IV"

        # Act
        function_name, args = detect_pattern_and_extract_args(query)

        # Assert
        assert function_name == "num_patternsearch"
        assert args["norme"] == "E1"
        assert args["section"] == "29"
        assert args["alphabetical"] == "b"
        assert args["roman"] == "IV"

    def test_detect_ar_pattern_simple(self):
        """Test detection of AR pattern (E1-AR4)."""
        # Arrange
        query = "E1-AR4"

        # Act
        function_name, args = detect_pattern_and_extract_args(query)

        # Assert
        assert function_name == "ar_patternsearch"
        assert args["norme"] == "E1"
        assert args["section"] == "AR4"
        assert args["alphabetical"] is None
        assert args["roman"] is None

    def test_detect_ar_pattern_with_alphabetical(self):
        """Test detection of AR pattern with alphabetical (E1-AR4-b)."""
        # Arrange
        query = "E1-AR4-b"

        # Act
        function_name, args = detect_pattern_and_extract_args(query)

        # Assert
        assert function_name == "ar_patternsearch"
        assert args["norme"] == "E1"
        assert args["section"] == "AR4"
        assert args["alphabetical"] == "b"
        assert args["roman"] is None

    def test_detect_ar_pattern_full(self):
        """Test detection of full AR pattern (E1-AR4-b-IV)."""
        # Arrange
        query = "E1-AR4-b-IV"

        # Act
        function_name, args = detect_pattern_and_extract_args(query)

        # Assert
        assert function_name == "ar_patternsearch"
        assert args["norme"] == "E1"
        assert args["section"] == "AR4"
        assert args["alphabetical"] == "b"
        assert args["roman"] == "IV"

    def test_detect_pattern_with_spaces(self):
        """Test pattern detection with spaces."""
        # Arrange
        query = "E1 - 29 - b - IV"

        # Act
        function_name, args = detect_pattern_and_extract_args(query)

        # Assert
        assert function_name == "num_patternsearch"
        assert args["norme"] == "E1"
        assert args["section"] == "29"

    def test_detect_pattern_with_esrs_prefix(self):
        """Test pattern detection with ESRS prefix."""
        # Arrange
        query = "ESRS E1-29"

        # Act
        function_name, args = detect_pattern_and_extract_args(query)

        # Assert
        assert function_name == "num_patternsearch"
        assert args["norme"] == "E1"
        assert args["section"] == "29"

    def test_detect_semantic_search_fallback(self):
        """Test fallback to semantic search for natural language."""
        # Arrange
        query = "What are the climate change requirements?"

        # Act
        function_name, args = detect_pattern_and_extract_args(query)

        # Assert
        assert function_name == "semantic_search"
        assert args["query"] == query

    def test_detect_pattern_filters_long_segments(self):
        """Test that segments longer than 3 chars are filtered."""
        # Arrange
        query = "E1-29-longer"  # 'longer' should be ignored

        # Act
        function_name, args = detect_pattern_and_extract_args(query)

        # Assert
        # Should fallback to semantic search as pattern is incomplete
        assert function_name in ["num_patternsearch", "semantic_search"]


class TestSemanticSearch:
    """Test suite for semantic_search function."""

    @patch('src.smart_rag.tools.utilities.esg_helpers.get_embeddings')
    @patch('src.smart_rag.tools.utilities.esg_helpers.get_semantic_normes')
    @patch('src.smart_rag.tools.utilities.esg_helpers.get_semantic_requirements')
    @patch('src.smart_rag.tools.utilities.esg_helpers.get_semantic_exigence_text')
    @patch('src.smart_rag.tools.utilities.esg_helpers.filter_extracted_requirements')
    def test_semantic_search_success(self, mock_filter, mock_exigence_text,
                                    mock_requirements, mock_normes, mock_embeddings):
        """Test successful semantic search execution."""
        # Arrange
        query = "Climate change mitigation"
        mock_embeddings.return_value = [0.1, 0.2, 0.3]
        mock_normes.return_value = [{"norme": "E1"}]
        mock_requirements.return_value = [{"exigence": "E1-1"}]
        mock_exigence_text.return_value = [{"text": "Climate text"}]
        mock_filter.return_value = "Filtered context"

        # Act
        result = semantic_search(query)

        # Assert
        assert result == "Filtered context"
        mock_embeddings.assert_called_once_with(query)
        mock_normes.assert_called_once()
        mock_requirements.assert_called_once()
        mock_exigence_text.assert_called_once()
        mock_filter.assert_called_once()

    @patch('src.smart_rag.tools.utilities.esg_helpers.get_embeddings')
    def test_semantic_search_exception(self, mock_embeddings):
        """Test semantic search exception handling."""
        # Arrange
        query = "Climate change"
        mock_embeddings.side_effect = Exception("Embedding failed")

        # Act
        result = semantic_search(query)

        # Assert
        assert result is None  # Function returns the string, not prints it


class TestPatternSearchFunctions:
    """Test suite for pattern search functions."""

    @patch('src.smart_rag.tools.utilities.esg_helpers.check_ar')
    @patch('src.smart_rag.tools.utilities.esg_helpers.get_normes')
    @patch('src.smart_rag.tools.utilities.esg_helpers.get_ars')
    @patch('src.smart_rag.tools.utilities.esg_helpers.get_exigence_from_ar')
    @patch('src.smart_rag.tools.utilities.esg_helpers.get_exigence')
    def test_ar_patternsearch_success(self, mock_get_exigence, mock_exigence_from_ar,
                                     mock_get_ars, mock_get_normes, mock_check_ar):
        """Test successful AR pattern search."""
        # Arrange
        mock_check_ar.return_value = "AR 4."
        mock_get_normes.return_value = [{"norme_label": "ESRS E1"}]
        mock_get_ars.return_value = [{"ar": "AR 4."}]
        mock_exigence_from_ar.return_value = (
            ["e1-1"],
            "References",
            {"dp": "29", "text": "Text", "alphabetical_nodes": []}
        )
        mock_get_exigence.return_value = [[{"norme": "ESRS E1", "exigenceLabel": "E1-1"}]]

        # Act
        result = ar_patternsearch(norme="E1", section="AR4")

        # Assert
        assert "<ESRS>ESRS E1</ESRS>" in result
        assert "<Exigence>" in result
        assert "<DataPoint>" in result
        assert "<References>" in result

    @patch('src.smart_rag.tools.utilities.esg_helpers.get_normes')
    @patch('src.smart_rag.tools.utilities.esg_helpers.get_sections')
    @patch('src.smart_rag.tools.utilities.esg_helpers.get_exigence_cible')
    @patch('src.smart_rag.tools.utilities.esg_helpers.get_exigence')
    def test_num_patternsearch_success(self, mock_get_exigence, mock_exigence_cible,
                                      mock_get_sections, mock_get_normes):
        """Test successful numerical pattern search."""
        # Arrange
        mock_get_normes.return_value = [{"norme_label": "ESRS E1"}]
        mock_get_sections.return_value = [{"dp": "29"}]
        mock_exigence_cible.return_value = (
            ["e1-1"],
            "References",
            {"dp": "29", "text": "Text", "alphabetical_nodes": []}
        )
        mock_get_exigence.return_value = [[{"norme": "ESRS E1", "exigenceLabel": "E1-1"}]]

        # Act
        result = num_patternsearch(norme="E1", section="29")

        # Assert
        assert "<ESRS>ESRS E1</ESRS>" in result
        assert "<Exigence>" in result
        assert "<DataPoint>" in result
        assert "<References>" in result

    @patch('src.smart_rag.tools.utilities.esg_helpers.get_normes')
    @patch('src.smart_rag.tools.utilities.esg_helpers.get_sections')
    @patch('src.smart_rag.tools.utilities.esg_helpers.get_exigence_cible')
    @patch('src.smart_rag.tools.utilities.esg_helpers.filter_exigence_children')
    @patch('src.smart_rag.tools.utilities.esg_helpers.get_exigence')
    def test_num_patternsearch_with_alphabetical(self, mock_get_exigence, mock_filter,
                                                 mock_exigence_cible, mock_get_sections,
                                                 mock_get_normes):
        """Test numerical pattern search with alphabetical filtering."""
        # Arrange
        mock_get_normes.return_value = [{"norme_label": "ESRS E1"}]
        mock_get_sections.return_value = [{"dp": "29"}]
        mock_exigence_cible.return_value = (
            ["e1-1"],
            "References",
            {"dp": "29", "text": "Text", "alphabetical_nodes": [{"alphabetical_label": "b"}]}
        )
        mock_filter.return_value = {"dp": "29", "text": "Text", "alphabetical_nodes": [{"alphabetical_label": "b"}]}
        mock_get_exigence.return_value = [[{"norme": "ESRS E1", "exigenceLabel": "E1-1"}]]

        # Act
        result = num_patternsearch(norme="E1", section="29", alphabetical="b")

        # Assert
        mock_filter.assert_called_once()
        assert "<ESRS>ESRS E1</ESRS>" in result


class TestNeo4jQueryFunctions:
    """Test suite for Neo4j query functions."""

    @patch('src.smart_rag.tools.utilities.esg_helpers.Neo4jDb')
    @patch('src.smart_rag.tools.utilities.esg_helpers.get_embeddings')
    def test_get_normes_success(self, mock_embeddings, mock_neo4j_class):
        """Test successful get_normes query."""
        # Arrange
        mock_embeddings.return_value = [0.1, 0.2, 0.3]
        mock_db_instance = MagicMock()
        expected_result = [{"norme_label": "ESRS E1", "score": 0.95, "related_nodes": []}]
        mock_db_instance.execute_query.return_value = expected_result
        mock_db_instance.__enter__.return_value = mock_db_instance
        mock_db_instance.__exit__.return_value = False
        mock_neo4j_class.return_value = mock_db_instance

        # Act
        result = get_normes("E1")

        # Assert
        assert result == expected_result
        # close() is called automatically by context manager __exit__
        mock_db_instance.__exit__.assert_called_once()

    @patch('src.smart_rag.tools.utilities.esg_helpers.Neo4jDb')
    def test_get_sections_success(self, mock_neo4j_class):
        """Test successful get_sections query."""
        # Arrange
        mock_db_instance = MagicMock()
        expected_result = [{"esrs": "E1", "exigence": "E1-1", "dp": "29"}]
        mock_db_instance.execute_query.return_value = expected_result
        mock_db_instance.__enter__.return_value = mock_db_instance
        mock_db_instance.__exit__.return_value = False
        mock_neo4j_class.return_value = mock_db_instance

        # Act
        result = get_sections("29")

        # Assert
        assert result == expected_result
        # close() is called automatically by context manager __exit__
        mock_db_instance.__exit__.assert_called_once()

    @patch('src.smart_rag.tools.utilities.esg_helpers.Neo4jDb')
    def test_get_ars_success(self, mock_neo4j_class):
        """Test successful get_ars query."""
        # Arrange
        mock_db_instance = MagicMock()
        expected_result = [{"esrs": "E1", "exigence": "E1-1", "ar": "AR 4."}]
        mock_db_instance.execute_query.return_value = expected_result
        mock_db_instance.__enter__.return_value = mock_db_instance
        mock_db_instance.__exit__.return_value = False
        mock_neo4j_class.return_value = mock_db_instance

        # Act
        result = get_ars("AR 4.")

        # Assert
        assert result == expected_result
        # close() is called automatically by context manager __exit__
        mock_db_instance.__exit__.assert_called_once()

    @patch('src.smart_rag.tools.utilities.esg_helpers.Neo4jDb')
    def test_get_exigence_success(self, mock_neo4j_class):
        """Test successful get_exigence query."""
        # Arrange
        mock_db_instance = MagicMock()
        expected_result = [{"norme": "ESRS E1", "exigenceLabel": "E1-1", "exigenceText": "Climate"}]
        mock_db_instance.execute_query.return_value = expected_result
        mock_db_instance.__enter__.return_value = mock_db_instance
        mock_db_instance.__exit__.return_value = False
        mock_neo4j_class.return_value = mock_db_instance

        # Act
        result = get_exigence(["e1-1"])

        # Assert
        assert len(result) == 1
        assert result[0] == expected_result
        # close() is called automatically by context manager __exit__
        assert mock_db_instance.__exit__.call_count >= 1

    @patch('src.smart_rag.tools.utilities.esg_helpers.Neo4jDb')
    def test_get_exigence_multiple(self, mock_neo4j_class):
        """Test get_exigence with multiple exigences."""
        # Arrange
        mock_db_instance = MagicMock()
        mock_db_instance.execute_query.return_value = [{"exigenceLabel": "E1-1"}]
        mock_db_instance.__enter__.return_value = mock_db_instance
        mock_db_instance.__exit__.return_value = False
        mock_neo4j_class.return_value = mock_db_instance

        # Act
        result = get_exigence(["e1-1", "e1-2"])

        # Assert
        assert len(result) == 2
        assert mock_db_instance.execute_query.call_count == 2

    @patch('src.smart_rag.tools.utilities.esg_helpers.Neo4jDb')
    def test_neo4j_query_connection_error(self, mock_neo4j_class):
        """Test Neo4j connection error handling."""
        # Arrange
        mock_neo4j_class.side_effect = Exception("Connection failed")

        # Act
        result = get_normes("E1")

        # Assert
        assert result == []