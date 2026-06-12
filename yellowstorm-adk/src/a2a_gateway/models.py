"""SQLAlchemy model for the A2A agent store."""

from datetime import datetime, timezone

from sqlalchemy import Column, String, Boolean, DateTime, JSON
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class A2AAgent(Base):
    """A published A2A agent.

    ``agent_id`` is the agent's own id (the proto ``Agent.id``) and is used as
    the URL path segment: ``/a2a/{agent_id}``. One published endpoint per agent.
    The API key is stored hashed; only its prefix is kept for display.
    """

    __tablename__ = "a2a_agents"

    agent_id = Column(String(255), primary_key=True)
    name = Column(String(255), nullable=False, default="")
    # Full `Agent` proto serialized as JSON (proto-json names).
    definition = Column(JSON, nullable=False)

    api_key_hash = Column(String(64), nullable=False)
    api_key_prefix = Column(String(16), nullable=False, default="")

    enabled = Column(Boolean, nullable=False, default=True)
    user_id = Column(String(255), nullable=True, index=True)

    created_at = Column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
