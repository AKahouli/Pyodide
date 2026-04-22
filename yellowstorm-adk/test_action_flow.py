"""Static verification of all layers without importing heavy modules."""
import sys

sys.stdout.reconfigure(encoding="utf-8")


def main():
    with open("src/grpc_server/chatbot_servicer.py", encoding="utf-8") as f:
        source = f.read()

    lines = source.splitlines()
    in_parser = False
    found_exec_mode = False
    found_selected_action = False
    for line in lines:
        if "def _proto_task_to_dict" in line:
            in_parser = True
        if in_parser and "execution_mode" in line and "getattr" in line:
            found_exec_mode = True
        if in_parser and "selected_action" in line and "getattr" in line:
            found_selected_action = True
        if in_parser and line.startswith("def ") and "def _proto_task_to_dict" not in line:
            break

    print(f"1. Parser has execution_mode getattr: {found_exec_mode}")
    print(f"2. Parser has selected_action getattr: {found_selected_action}")

    with open("src/langgraph_engine/graph_builder.py", encoding="utf-8") as f:
        gb_source = f.read()

    has_action_import = "from src.langgraph_engine.action_executor import execute_action_task" in gb_source
    has_action_branch = 'execution_mode_value == "action"' in gb_source
    has_action_call = "execute_action_task(" in gb_source

    print(f"3. Graph builder has action import: {has_action_import}")
    print(f"4. Graph builder has action branch: {has_action_branch}")
    print(f"5. Graph builder calls execute_action_task: {has_action_call}")

    has_runstep_action = all(x in source for x in [
        'str(task.get("execution_mode")',
        "execute_action_task(",
    ])
    print(f"6. RunStep/RunStepStream has action routing: {has_runstep_action}")

    with open("grpc/proto/chatbot.proto", encoding="utf-8") as f:
        adk_proto = f.read()
    with open("../YellowStorm/back/src/modules/conversation/proto/chatbot.proto", encoding="utf-8") as f:
        back_proto = f.read()

    adk_has_task_mode = "string execution_mode = 19" in adk_proto
    back_has_task_mode = "string execution_mode = 19" in back_proto
    adk_has_task_action = "string selected_action = 20" in adk_proto
    back_has_task_action = "string selected_action = 20" in back_proto
    adk_has_ws_chunks = "int32 chunks = 3" in adk_proto
    back_has_ws_chunks = "int32 chunks = 3" in back_proto

    print(f"7. ADK proto has task execution_mode=19: {adk_has_task_mode}")
    print(f"8. Backend proto has task execution_mode=19: {back_has_task_mode}")
    print(f"9. ADK proto has task selected_action=20: {adk_has_task_action}")
    print(f"10. Backend proto has task selected_action=20: {back_has_task_action}")
    print(f"11. ADK proto has workspace chunks=3: {adk_has_ws_chunks}")
    print(f"12. Backend proto has workspace chunks=3: {back_has_ws_chunks}")

    with open("src/grpc_generated/chatbot_pb2.py", encoding="utf-8") as f:
        pb2 = f.read()
    has_pb2_exec = "execution_mode" in pb2
    has_pb2_action = "selected_action" in pb2
    print(f"13. Generated pb2 has execution_mode: {has_pb2_exec}")
    print(f"14. Generated pb2 has selected_action: {has_pb2_action}")

    with open("src/langgraph_engine/action_executor.py", encoding="utf-8") as f:
        ae_source = f.read()
    has_token_generation = "async def _generate_token()" in ae_source
    has_no_stdlib_logger_kwarg = "error=str(e)" not in ae_source
    has_no_action_kwarg = "action=action" not in ae_source
    print(f"15. Action executor has token generation helper: {has_token_generation}")
    print(f"16. Action executor has no stdlib logger kwargs: {has_no_stdlib_logger_kwarg}")
    print(f"17. Action executor has no action= kwarg: {has_no_action_kwarg}")

    checks = [
        found_exec_mode, found_selected_action,
        has_action_import, has_action_branch, has_action_call,
        has_runstep_action,
        adk_has_task_mode, back_has_task_mode,
        adk_has_task_action, back_has_task_action,
        adk_has_ws_chunks, back_has_ws_chunks,
        has_pb2_exec, has_pb2_action,
        has_token_generation, has_no_stdlib_logger_kwarg, has_no_action_kwarg,
    ]

    print()
    failed = [i + 1 for i, c in enumerate(checks) if not c]
    if failed:
        print(f"FAILED checks: {failed}")
    else:
        print("ALL 17 CHECKS PASSED")


if __name__ == "__main__":
    main()
