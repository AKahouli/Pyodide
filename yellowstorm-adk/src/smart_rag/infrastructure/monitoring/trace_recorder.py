import time

class MockLangfuse:
    def trace(self, **kwargs): return self
    def span(self, **kwargs): return self
    def event(self, **kwargs): return self
    def update(self, **kwargs): return self
    def flush(self, **kwargs): pass
    def __getattr__(self, name): return lambda *args, **kwargs: self

langfuse_client = MockLangfuse()

class TraceRecorder:
    def __init__(self, agent_name=None, agent_type=None):
        self.agent_name = agent_name
        self.agent_type = agent_type
        self.history = []
        self.text_chunks = []
        self.function_calls = []
        self.function_responses = []
        self.errors = []
        self.final_result = None
        self.pending_function_call = None

    def record_chunk(self, text):
        self.text_chunks.append(text)

    def record_function_call(self, func_name, args, tool_category):
        pass

    def record_function_response(self, response, success):
        pass

    def record_error(self, error_message):
        pass

    def record_final_result(self, result):
        pass

    def get_execution_summary(self):
        return {"execution_statistics": {}}

    def _get_timestamp(self):
        return time.time()
