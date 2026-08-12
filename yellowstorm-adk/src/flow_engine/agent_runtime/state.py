from langgraph.graph import MessagesState


class StepAgentState(MessagesState):
    tool_iterations: int
    guardrail_blocked: bool
    guardrail_reason: str
