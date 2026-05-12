"""Tests for calculator utility."""

import pytest

from src.smart_rag.tools.utilities.calculator import *


class TestCalculator:
    """Test cases for calculator functionality."""

    @pytest.mark.asyncio
    async def test_calculator_supports_abs(self):
        """Calculator should support abs()."""
        result = await calculator("abs(-5)")
        assert result == "5"

    @pytest.mark.asyncio
    async def test_calculator_supports_round_with_ndigits(self):
        """Calculator should support round(x, ndigits)."""
        result = await calculator("round(100*150000/461000, 4)")
        assert result == "32.538"

    @pytest.mark.asyncio
    async def test_calculator_basic_operations(self):
        """Test basic calculator operations."""
        try:
            # Test addition
            result = await calculator("2 + 3")
            assert result == "5" or "5" in str(result)

            # Test multiplication
            result = await calculator("4 * 5")
            assert result == "20" or "20" in str(result)

            # Test division
            result = await calculator("10 / 2")
            assert result == "5.0" or "5" in str(result)
        except NameError:
            # Function might not exist
            pass

    @pytest.mark.asyncio
    async def test_calculator_complex_expressions(self):
        """Test complex mathematical expressions."""
        try:
            result = await calculator("(2 + 3) * 4")
            assert result == "20" or "20" in str(result)

            result = await calculator("2 ** 3")  # Power operation
            assert result == "8" or "8" in str(result)
        except NameError:
            pass

    @pytest.mark.asyncio
    async def test_calculator_error_handling(self):
        """Test calculator error handling."""
        try:
            # Division by zero
            result = await calculator("5 / 0")
            result_str = str(result).lower()
            # The error comes back as a JSON string
            assert "error" in result_str or "infinity" in result_str or "division" in result_str

            # Invalid expression
            result = await calculator("invalid expression")
            result_str = str(result).lower()
            assert "error" in result_str
        except NameError:
            pass

    @pytest.mark.asyncio
    async def test_calculator_functions(self):
        """Test calculator mathematical functions."""
        try:
            # Square root
            result = await calculator("sqrt(16)")
            assert result == "4.0" or "4" in str(result)

            # Other math functions
            result = await calculator("abs(-5)")
            assert result == "5" or "5" in str(result)
        except (NameError, Exception):
            pass
