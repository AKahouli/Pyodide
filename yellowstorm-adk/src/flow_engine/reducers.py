"""Reducer functions for LangGraph ExecutionState fields.

Every state field with parallel-write semantics gets an explicit
reducer.  Reducers are pure functions: (left, right) -> merged.
"""

from typing import Any, TypeVar


T = TypeVar("T")


def set_by_key(left: dict[T, Any], right: dict[T, Any]) -> dict[T, Any]:
    if not left:
        return right
    if not right:
        return left
    merged = dict(left)
    merged.update(right)
    return merged


def append(left: list[T], right: list[T]) -> list[T]:
    if not left:
        return right
    if not right:
        return left
    return left + right


def max_of(left: dict[str, int], right: dict[str, int]) -> dict[str, int]:
    if not left:
        return right
    if not right:
        return left
    merged = dict(left)
    for key, value in right.items():
        merged[key] = max(merged.get(key, 0), value)
    return merged


def last_write(left: T, right: T) -> T:
    return right


def or_(left: bool, right: bool) -> bool:
    return left or right
