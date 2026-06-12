from enum import Enum


class SearchType(str, Enum):
    VECTOR = "vector"
    FULL_TEXT = "full_text"
