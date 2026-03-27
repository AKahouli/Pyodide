"""Tests for MessageTransformer."""

import pytest
from src.smart_rag.messaging.transformers import MessageTransformer


class TestMessageTransformer:
    """Test cases for MessageTransformer."""

    def test_init(self):
        """Test transformer initialization."""
        transformer = MessageTransformer()
        assert transformer is not None

    def test_simple_tag_transformer_basic(self):
        """Test simple tag transformer with basic input."""
        # Test with simple message without any citations
        processed, buffer, citations = MessageTransformer.simple_tag_transformer(
            tempmsg="Hello world",
            task_n=1,
            buffer="",
            max_length=50
        )

        assert processed == "Hello world"
        assert buffer == ""
        assert citations == []

    def test_simple_tag_transformer_with_buffer(self):
        """Test simple tag transformer with buffer."""
        # Test with buffer that gets combined
        processed, buffer, citations = MessageTransformer.simple_tag_transformer(
            tempmsg=" world",
            task_n=1,
            buffer="Hello",
            max_length=50
        )

        assert processed == "Hello world"
        assert buffer == ""
        assert citations == []

    def test_simple_tag_transformer_with_citation(self):
        """Test simple tag transformer detects complete citations."""
        # A complete citation like [1] at the end should be detected and removed
        processed, buffer, citations = MessageTransformer.simple_tag_transformer(
            tempmsg="See reference [1]",
            task_n=1,
            buffer="",
            max_length=200
        )

        assert "[1]" in citations
        assert "[1]" not in processed
        assert "See reference " in processed

    def test_simple_tag_transformer_accumulation(self):
        """Test simple tag transformer with message accumulation."""
        # First chunk - should be processed normally since no incomplete citations
        processed1, buffer1, citations1 = MessageTransformer.simple_tag_transformer(
            tempmsg="Hello",
            task_n=1,
            buffer="",
            max_length=20
        )

        # First chunk should process normally and buffer should be empty
        assert processed1 == "Hello"
        assert buffer1 == ""
        assert citations1 == []

        # Second chunk - should accumulate normally
        processed2, buffer2, citations2 = MessageTransformer.simple_tag_transformer(
            tempmsg=" world",
            task_n=1,
            buffer="",
            max_length=20
        )

        assert processed2 == " world"
        assert citations2 == []

    def test_simple_tag_transformer_incomplete_citation_buffered(self):
        """Test simple tag transformer buffers incomplete citations."""
        # Test with incomplete citation at the end: '[' followed by partial content
        processed, buffer, citations = MessageTransformer.simple_tag_transformer(
            tempmsg="Some text [1",
            task_n=1,
            buffer="",
            max_length=200
        )

        # Incomplete citation should be moved to buffer
        assert processed == "Some text "
        assert buffer == "[1"
        assert citations == []

    def test_simple_tag_transformer_incomplete_then_complete(self):
        """Test buffered incomplete citation completed in next chunk."""
        # First chunk has incomplete citation
        processed1, buffer1, citations1 = MessageTransformer.simple_tag_transformer(
            tempmsg="See ref [1",
            task_n=1,
            buffer="",
            max_length=200
        )

        assert buffer1 == "[1"

        # Second chunk completes the citation
        processed2, buffer2, citations2 = MessageTransformer.simple_tag_transformer(
            tempmsg="]",
            task_n=1,
            buffer=buffer1,
            max_length=200
        )

        assert "[1]" in citations2
        assert buffer2 == ""

    def test_simple_tag_transformer_multiple_citations(self):
        """Test simple tag transformer with multiple citations."""
        # Use force_flush to detect all citations at once
        processed, buffer, citations = MessageTransformer.simple_tag_transformer(
            tempmsg="References [1] and [2] and [3]",
            task_n=1,
            buffer="",
            max_length=200,
            force_flush=True
        )

        assert "[1]" in citations
        assert "[2]" in citations
        assert "[3]" in citations
        assert len(citations) == 3
        assert "[1]" not in processed
        assert "[2]" not in processed
        assert "[3]" not in processed
        assert buffer == ""

    def test_simple_tag_transformer_force_flush(self):
        """Test force_flush mode sends everything including incomplete citations."""
        # force_flush should detect citations and return everything
        processed, buffer, citations = MessageTransformer.simple_tag_transformer(
            tempmsg="Final text [42]",
            task_n=1,
            buffer="buffered ",
            max_length=200,
            force_flush=True
        )

        assert "[42]" in citations
        assert "[42]" not in processed
        assert "buffered Final text " in processed
        assert buffer == ""

    def test_simple_tag_transformer_no_citation_bracket(self):
        """Test bracket that is not a citation (non-numeric content)."""
        # Brackets with non-numeric content should not be treated as citations
        # After MAX_CITATION_BUFFER chars without ], the bracket is flushed
        processed, buffer, citations = MessageTransformer.simple_tag_transformer(
            tempmsg="Some text [not a citation at all]",
            task_n=1,
            buffer="",
            max_length=200
        )

        assert citations == []
        assert "Some text [not a citation at all]" in processed

    def test_simple_tag_transformer_large_citation_number(self):
        """Test citation with large number like [123]."""
        processed, buffer, citations = MessageTransformer.simple_tag_transformer(
            tempmsg="Reference [123]",
            task_n=1,
            buffer="",
            max_length=200
        )

        assert "[123]" in citations
        assert "[123]" not in processed

    def test_simple_tag_transformer_various_task_numbers(self):
        """Test simple tag transformer with different task numbers (task_n is unused but accepted)."""
        message = "Content with [1] reference"

        # task_n is kept for compatibility but not used in the current implementation
        for task_n in [1, 5, 10, 100]:
            processed, buffer, citations = MessageTransformer.simple_tag_transformer(
                tempmsg=message,
                task_n=task_n,
                buffer="",
                max_length=200
            )
            assert "[1]" in citations
            assert "[1]" not in processed

    def test_methods_are_static(self):
        """Test that methods can be called as static methods."""
        # Should be able to call without instantiating the class
        processed, buffer, citations = MessageTransformer.simple_tag_transformer("test", 1, "", 100)
        assert processed == "test"
        assert buffer == ""
        assert citations == []

    def test_simple_tag_transformer_mixed_content(self):
        """Test simple tag transformer with mixed content types."""
        message = "Text [1] and more [2] plus plain text"
        processed, buffer, citations = MessageTransformer.simple_tag_transformer(
            tempmsg=message,
            task_n=1,
            buffer="",
            max_length=200,
            force_flush=True
        )

        assert "[1]" in citations
        assert "[2]" in citations
        assert "[1]" not in processed
        assert "[2]" not in processed
        assert "Text " in processed
        assert " and more " in processed
        assert " plus plain text" in processed

    def test_simple_tag_transformer_citation_at_boundary(self):
        """Test citation split across buffer boundary."""
        # Simulate streaming where citation is split: '[' comes first
        processed1, buffer1, citations1 = MessageTransformer.simple_tag_transformer(
            tempmsg="end of chunk [",
            task_n=1,
            buffer="",
            max_length=200
        )

        assert buffer1 == "["
        assert processed1 == "end of chunk "

        # Then the rest arrives
        processed2, buffer2, citations2 = MessageTransformer.simple_tag_transformer(
            tempmsg="5]",
            task_n=1,
            buffer=buffer1,
            max_length=200
        )

        assert "[5]" in citations2
        assert buffer2 == ""

    def test_simple_tag_transformer_empty_input(self):
        """Test simple tag transformer with empty input."""
        processed, buffer, citations = MessageTransformer.simple_tag_transformer(
            tempmsg="",
            task_n=1,
            buffer="",
            max_length=200
        )

        assert processed == ""
        assert buffer == ""
        assert citations == []

    def test_simple_tag_transformer_only_buffer(self):
        """Test simple tag transformer with only buffer content and empty tempmsg."""
        processed, buffer, citations = MessageTransformer.simple_tag_transformer(
            tempmsg="",
            task_n=1,
            buffer="Hello",
            max_length=200
        )

        assert processed == "Hello"
        assert buffer == ""
        assert citations == []

    def test_simple_tag_transformer_force_flush_with_incomplete(self):
        """Test force_flush with incomplete bracket pattern."""
        # force_flush should return everything even if there's an incomplete bracket
        processed, buffer, citations = MessageTransformer.simple_tag_transformer(
            tempmsg="",
            task_n=1,
            buffer="trailing text [incomplete",
            max_length=200,
            force_flush=True
        )

        assert "trailing text [incomplete" in processed
        assert buffer == ""
        assert citations == []
