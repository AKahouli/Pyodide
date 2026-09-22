"""Text-only attachment profiling for Conversation files.

Downloads a stored file, extracts bounded plain text, and counts tabular rows
(streaming, early-stop) so the backend can decide the attachment policy.
This service never indexes anything and never extracts images.
"""
