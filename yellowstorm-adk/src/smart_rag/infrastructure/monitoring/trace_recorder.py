import base64

from langfuse.decorators import observe
from langfuse import Langfuse
from src.config.settings import get_settings
app_settings = get_settings()

LANGFUSE_AUTH = base64.b64encode(
    f"{app_settings.LANGFUSE_PUBLIC_KEY}:{app_settings.LANGFUSE_SECRET_KEY}".encode()).decode()

OTEL_EXPORTER_OTLP_ENDPOINT = app_settings.LANGFUSE_HOST + "/api/public/otel"
OTEL_EXPORTER_OTLP_HEADERS = f"Authorization=Basic {LANGFUSE_AUTH}"

# Initialize Langfuse client for direct API calls
langfuse_client = Langfuse(
    public_key=app_settings.LANGFUSE_PUBLIC_KEY,
    secret_key=app_settings.LANGFUSE_SECRET_KEY,
    host=app_settings.LANGFUSE_HOST,
)


class TraceRecorder:
    def __init__(self, agent_name=None, agent_type=None):
        self.agent_name = agent_name
        self.agent_type = agent_type
        self.history = []  # keeps everything for debugging/logging
        self.text_chunks = []
        self.function_calls = []
        self.function_responses = []
        self.errors = []
        self.final_result = None
        self.pending_function_call = None  # Track ongoing function call

    def record_chunk(self, text):
        entry = {"type": "text_chunk", "text": text, "timestamp": self._get_timestamp()}
        self.history.append(entry)
        self.text_chunks.append(text)

    def record_function_call(self, func_name, args, tool_category):
        entry = {
            "type": "function_call",
            "function_name": func_name,
            "arguments": args or {},
            "tool_category": tool_category,
            "timestamp": self._get_timestamp()
        }
        self.pending_function_call = entry  # Store for merging
        self.history.append(entry)
        self.function_calls.append(entry)

    def record_function_response(self, response, success):
        entry = {
            "type": "function_response",
            "response": str(response) if response else "No response",
            "response_length": len(str(response)) if response else 0,
            "success": success,
            "timestamp": self._get_timestamp()
        }
        self.history.append(entry)
        self.function_responses.append(entry)
        self.pending_function_call = None

    def record_error(self, error_message):
        entry = {"type": "error", "error": str(error_message), "timestamp": self._get_timestamp()}
        self.history.append(entry)
        self.errors.append(entry)

    def record_final_result(self, result):
        self.final_result = result

    def get_execution_summary(self):
        """Get a comprehensive, step-by-step summary of the agent execution for tracing."""
        # Create chronological execution flow with merged function calls and responses
        execution_flow = []
        pending_function_call = None

        # Merge function calls with their responses
        for entry in self.history:
            if entry["type"] == "text_chunk":
                execution_flow.append({
                    "step_type": "text_generation",
                    "timestamp": entry["timestamp"],
                    "content": entry["text"],
                    "length": len(entry["text"])
                })
            elif entry["type"] == "function_call":
                # Store function call to merge with response
                pending_function_call = {
                    "step_type": "function_execution",
                    "timestamp": entry["timestamp"],
                    "input": {
                        "function_name": entry["function_name"],
                        "arguments": entry["arguments"],
                        "tool_category": entry["tool_category"]
                    },
                    "output": None,
                    "success": None
                }
            elif entry["type"] == "function_response":
                # Merge with pending function call
                if pending_function_call:
                    pending_function_call["output"] = {
                        "response": entry["response"],
                        "response_length": entry["response_length"]
                    }
                    pending_function_call["success"] = entry["success"]
                    execution_flow.append(pending_function_call)
                    pending_function_call = None
                else:
                    # Orphaned response (shouldn't happen but handle gracefully)
                    execution_flow.append({
                        "step_type": "function_response",
                        "timestamp": entry["timestamp"],
                        "response": entry["response"],
                        "response_length": entry["response_length"],
                        "success": entry["success"]
                    })
            elif entry["type"] == "error":
                execution_flow.append({
                    "step_type": "error",
                    "timestamp": entry["timestamp"],
                    "error_message": entry["error"]
                })

        # Handle any pending function call without response
        if pending_function_call:
            pending_function_call["output"] = {"response": "No response received", "response_length": 0}
            pending_function_call["success"] = False
            execution_flow.append(pending_function_call)

        # Calculate summary statistics
        total_text_length = sum(len(chunk) for chunk in self.text_chunks)
        combined_text = "".join(self.text_chunks)

        return {
            "agent_name": self.agent_name,
            "agent_type": self.agent_type,
            "execution_flow": execution_flow,

            # Summary statistics at the end
            "execution_statistics": {
                "total_text_chunks": len(self.text_chunks),
                "total_text_length": total_text_length,
                "combined_generated_text": combined_text,
                "function_calls_count": len(self.function_calls),
                "function_responses_count": len(self.function_responses),
                "errors_count": len(self.errors),
                "execution_success": len(self.errors) == 0,
                "final_result": self.final_result
            },
        }

    def _get_timestamp(self):
        import time
        return time.time()
