"""Infrastructure and supporting services.

This module contains supporting infrastructure organized by function:
- session: Session management
- processing: Processing helpers and utilities
- external: External service integration
- factories: Infrastructure factories
- monitoring: Observability and monitoring

These provide the foundational services that support the main functionality.
"""

# Import on demand to avoid circular dependencies
__all__ = [
    'session',
    'processing', 
    'external',
    'factories',
    'monitoring'
]