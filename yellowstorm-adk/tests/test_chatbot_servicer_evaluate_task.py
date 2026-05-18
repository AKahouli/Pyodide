import pytest

pytest.importorskip("src.grpc_generated.chatbot_pb2")

from src.grpc_generated import chatbot_pb2
from src.grpc_server.chatbot_servicer import ChatbotServicer


@pytest.mark.asyncio
async def test_evaluate_task_returns_grpc_result() -> None:
    servicer = ChatbotServicer(agent_team_service=None)
    request = chatbot_pb2.TaskAdvisorRequest(
        execution_id="exec-1",
        owner_id="user-1",
        playbook_id="playbook-1",
        task_id="task-1",
        task_title="Draft report",
        task_description="Draft the final report.",
        expected_result="final report",
        task_output="This final report includes an executive summary.",
        task_status="completed",
    )

    result = await servicer.EvaluateTask(request, context=None)

    assert result.overall_score >= 0
    assert result.expected_result_source == "node_field"
