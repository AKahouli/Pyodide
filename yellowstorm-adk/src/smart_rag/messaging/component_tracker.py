"""
Component Tracker Module

Tracks which agents have sent components to determine if action should be "add" or "update".
"""
import uuid
from typing import Dict, List, Tuple
from src.logger.logging import get_logger

logger = get_logger("api.smart_rag.component_tracker")


class ComponentTracker:
    """Tracks component state per session to determine add vs update actions.

    For each session, tracks which agent IDs have active components.
    - No active component for agent -> action: "add"
    - Same component type -> reuse component ID, action: "update"
    - Different component type -> new component ID, action: "add"
    """

    def __init__(self, session_id: str):
        """Initialize component tracker for a session.

        Args:
            session_id: The session identifier
        """
        self.session_id = session_id
        self._active_components: Dict[str, Dict[str, str]] = {}  # agent_id -> {"component_id": ..., "component_type": ...}
        self._plan_component_id: str = str(uuid.uuid4())
        self._plan_sent: bool = False
        logger.info(f"[ComponentTracker] Initialized for session {session_id}")

    def resolve(self, agent_id: str, component_type: str) -> Tuple[str, str]:
        """Single entry point: returns (component_id, action).

        - No active component -> new UUID, "add"
        - Same type -> reuse UUID, "update"
        - Different type -> new UUID, "add"

        Args:
            agent_id: The agent identifier
            component_type: The component type (text, plan, code, etc.)

        Returns:
            Tuple of (component_id, action)
        """
        active = self._active_components.get(agent_id)

        if active is None:
            # No active component for this agent -> add
            component_id = str(uuid.uuid4())
            self._active_components[agent_id] = {
                "component_id": component_id,
                "component_type": component_type,
            }
            logger.debug(f"[ComponentTracker] New component {component_id} for agent {agent_id} (type: {component_type})")
            return component_id, "add"

        if active["component_type"] == component_type:
            # Same type -> update existing component
            logger.debug(f"[ComponentTracker] Update component {active['component_id']} for agent {agent_id}")
            return active["component_id"], "update"

        # Different type -> new component
        component_id = str(uuid.uuid4())
        self._active_components[agent_id] = {
            "component_id": component_id,
            "component_type": component_type,
        }
        logger.debug(f"[ComponentTracker] Type changed for agent {agent_id}, new component {component_id} (type: {component_type})")
        return component_id, "add"

    def resolve_plan(self) -> List[Tuple[str, str]]:
        """Resolve actions for the plan component.

        The plan keeps a single persistent component_id for the session.
        - First call: [("add", component_id)]
        - Subsequent calls: [("delete", component_id), ("add", component_id)]

        Returns:
            List of (action, component_id) tuples to send in order.
        """
        component_id = self._plan_component_id

        if not self._plan_sent:
            self._plan_sent = True
            return [("add", component_id)]

        return [("delete", component_id), ("add", component_id)]

    def finish_component(self, agent_id: str) -> None:
        """Clear tracking for an agent so the next event creates a new component.

        This is used when an agent returns after other agents have spoken (e.g., manager
        returns after delegation), so its next text should be a new component, not an
        update to the previous one.

        Args:
            agent_id: The agent identifier to reset
        """
        self._active_components.pop(agent_id, None)
        logger.debug(f"[ComponentTracker] Finished component for agent {agent_id}")
