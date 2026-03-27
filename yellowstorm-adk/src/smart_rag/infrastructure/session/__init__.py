"""Session management module.

This module contains session management functionality:
- manager: Session manager (formerly session_helper.py)

Provides session lifecycle management for agents and processing engines.
"""

from .manager import SessionHelper

__all__ = [
    'SessionHelper'
]