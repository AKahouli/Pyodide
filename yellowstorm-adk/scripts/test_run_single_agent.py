"""Smoke test for the RunSingleAgent gRPC RPC (mono-agent, no manager)."""

import sys
import grpc

from src.grpc_generated import chatbot_pb2, chatbot_pb2_grpc

MODEL = sys.argv[1] if len(sys.argv) > 1 else "gpt-4.1-mini"


def main():
    channel = grpc.insecure_channel("127.0.0.1:50051")
    stub = chatbot_pb2_grpc.ChatbotServiceStub(channel)

    request = chatbot_pb2.RunSingleAgentRequest(
        user_context=chatbot_pb2.UserContext(user_id="test-user", username="tester"),
        conversation_id="mono-smoke-001",
        query="In exactly one short sentence, say hello and confirm you are a single agent.",
        agent=chatbot_pb2.Agent(
            id="agent-1",
            name="SoloAgent",
            description="A standalone assistant",
            prompt="You are SoloAgent, a concise helpful assistant. Answer directly.",
            chatbot=chatbot_pb2.Chatbot(model=MODEL),
        ),
    )

    print(f"[client] Calling RunSingleAgent (model={MODEL}) ...", flush=True)
    text_parts = []
    chunk_count = 0
    try:
        for chunk in stub.RunSingleAgent(request, timeout=120):
            chunk_count += 1
            comp = chunk.component
            ctype = comp.WhichOneof("data")
            if ctype == "text":
                text_parts.append(comp.text.content)
                print(f"  [text] {comp.text.content!r}", flush=True)
            elif ctype == "error":
                print(f"  [ERROR component] {comp.error.title}: {comp.error.content}", flush=True)
            elif ctype:
                print(f"  [{ctype}] {chunk.action}", flush=True)
            elif chunk.usage.total_tokens:
                print(f"  [usage] in={chunk.usage.input_tokens} out={chunk.usage.output_tokens} model={chunk.usage.model}", flush=True)
    except grpc.RpcError as e:
        print(f"[client] RPC FAILED: {e.code()} - {e.details()}", flush=True)
        sys.exit(2)

    print("\n========== RESULT ==========", flush=True)
    print(f"chunks received: {chunk_count}", flush=True)
    print(f"assembled text : {''.join(text_parts).strip()!r}", flush=True)
    if not chunk_count:
        print("NO CHUNKS RECEIVED", flush=True)
        sys.exit(3)


if __name__ == "__main__":
    main()
