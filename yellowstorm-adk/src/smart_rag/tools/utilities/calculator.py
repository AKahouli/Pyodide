"""
Calculator Tool Module

Provides safe mathematical expression evaluation functionality.
Optimized for parallel execution with async/await support.
"""

import asyncio
import ast
import json
import math
import operator
from src.logger.logging import get_logger
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import ThreadPoolExecutor

logger = get_logger("api.smart_rag.tools.calculator")

# Supported mathematical operators
_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.Mod: operator.mod,
    ast.USub: operator.neg,
}


def _safe_eval(node):
    """
    Recursively evaluate an AST node, allowing only basic math operations and sqrt function.
    Supports numeric literals, binary and unary operations, and sqrt(x).
    
    Args:
        node: AST node to evaluate
        
    Returns:
        Evaluated numeric result
        
    Raises:
        ValueError: For unsupported operations or expressions
    """
    # Numeric literals (Python 3.8+ uses ast.Constant)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    # Legacy numeric literal
    if isinstance(node, ast.Num):
        return node.n
    # Handle function calls like sqrt(x)
    if isinstance(node, ast.Call):
        if isinstance(node.func, ast.Name) and node.func.id == 'sqrt' and len(node.args) == 1:
            value = _safe_eval(node.args[0])
            return math.sqrt(value)
        raise ValueError(f"Unsupported function call: {ast.dump(node)}")
    # Binary operations
    if isinstance(node, ast.BinOp):
        left = _safe_eval(node.left)
        right = _safe_eval(node.right)
        op_type = type(node.op)
        if op_type in _OPERATORS:
            return _OPERATORS[op_type](left, right)
        raise ValueError(f"Unsupported binary operator: {op_type}")
    # Unary operations
    if isinstance(node, ast.UnaryOp):
        operand = _safe_eval(node.operand)
        op_type = type(node.op)
        if op_type in _OPERATORS:
            return _OPERATORS[op_type](operand)
        raise ValueError(f"Unsupported unary operator: {op_type}")
    raise ValueError(f"Unsupported expression: {ast.dump(node)}")


async def calculator(expression: str) -> str:
    """
    Evaluate a basic arithmetic expression safely and return a JSON result.

    This function is optimized for parallel execution - call multiple times for different calculations.

    Supported operations: +, -, *, /, **, %, unary -, and sqrt(x).

    Args:
        expression (str): The math expression to evaluate.

    Returns:
        str: JSON string containing the operation and result or error.

    Examples:
        >>>calculator("2 + 3 * 4")
        '14'
        >>>calculator("sqrt(16)")
        '4.0'
        >>>calculator("2 ** 3")
        '8'
    """
    try:
        # Yield control to allow parallel execution
        await asyncio.sleep(0)

        # Parse expression in a thread pool for CPU-intensive operations
        loop = asyncio.get_event_loop()

        with ThreadPoolExecutor() as executor:
            def _compute():
                parsed = ast.parse(expression, mode='eval')
                return _safe_eval(parsed.body)

            result = await loop.run_in_executor(executor, _compute)

        return str(result)
    except Exception as e:
        logger.error(f"Failed to evaluate expression '{expression}': {str(e)}")
        return json.dumps({"operation": "calculation", "expression": expression, "error": str(e)})


def is_safe_expression(expression: str) -> bool:
    """
    Check if an expression contains only safe mathematical operations.
    
    Args:
        expression: Mathematical expression to validate
        
    Returns:
        bool: True if expression is safe, False otherwise
    """
    try:
        parsed = ast.parse(expression, mode='eval')
        _safe_eval(parsed.body)
        return True
    except (ValueError, SyntaxError):
        return False


def get_supported_operations() -> dict:
    """
    Get information about supported mathematical operations.
    
    Returns:
        dict: Dictionary of supported operations and their descriptions
    """
    return {
        "arithmetic": ["addition (+)", "subtraction (-)", "multiplication (*)", "division (/)"],
        "advanced": ["exponentiation (**)", "modulo (%)", "square root (sqrt())"],
        "unary": ["negation (-)"],
        "examples": [
            "2 + 3 * 4",
            "sqrt(16)",
            "2 ** 3 % 5",
            "-(10 / 2)"
        ]
    }