"""Disposable production gRPC host for the isolated Nest/provider qualification."""
import asyncio
import json
import os
import sys
import traceback

from dotenv import load_dotenv
from sqlalchemy.engine import make_url


async def main():
    load_dotenv(override=False)
    database = make_url(os.environ['ROOT_WORK_DATABASE_URL'])
    if database.database != 'agentstore_test':
        raise ValueError('Qualification requires agentstore_test')
    import grpc
    from src.grpc_generated import chatbot_pb2_grpc
    from src.grpc_server.chatbot_servicer import ChatbotServicer
    from src.grpc_server.auth_interceptor import ApiKeyAuthInterceptor
    from src.root_runtime.background_host import BackgroundInvocationHost
    from src.smart_rag.core.agent_team_service import AgentTeamService

    # Protocol fixture only: one owned Workflow item pauses; other items use the real factory/provider.
    if os.environ.get('VECTOR_NATIVE_WAIT_FIXTURE') == 'true':
        from google.adk.workflow import FunctionNode
        from google.adk.agents.context import Context
        from google.adk.events.request_input import RequestInput
        from src.root_runtime import dispatcher
        original_compile = dispatcher._compile_candidate
        parked_scope = None

        async def parking(ctx: Context):
            if 'qualification_pause' not in ctx.resume_inputs:
                return RequestInput(interrupt_id='qualification_pause', message='Qualification input',
                    response_schema={'type': 'object', 'properties': {'allow': {'type': 'boolean'}},
                        'required': ['allow'], 'additionalProperties': False})
            if ctx.resume_inputs['qualification_pause'].get('allow') is not False:
                raise ValueError('Qualification requires typed false')
            return 'VECTORNATIVENEST typed_false'

        async def compile_with_pause(team, request, candidate, scope, authorize=None):
            nonlocal parked_scope
            if parked_scope is None:
                parked_scope = scope.execution_id
            if scope.execution_id == parked_scope:
                return FunctionNode(func=parking, name='qualification_pause', rerun_on_resume=True)
            print('VECTOR_NATIVE_DIAGNOSTIC ' + json.dumps({'kind': 'fixture_compile',
                'executionId': scope.execution_id}), flush=True)
            return await original_compile(team, request, candidate, scope, authorize=authorize)
        dispatcher._compile_candidate = compile_with_pause

    original_start = BackgroundInvocationHost.start
    async def diagnosed_start(host, request):
        try:
            return await original_start(host, request)
        except Exception as error:
            print('VECTOR_NATIVE_DIAGNOSTIC ' + json.dumps({'class': type(error).__name__,
                'frames': [{'file': os.path.basename(frame.filename), 'line': frame.lineno}
                    for frame in traceback.extract_tb(error.__traceback__)[-5:]]}), flush=True)
            raise
    BackgroundInvocationHost.start = diagnosed_start

    servicer = ChatbotServicer(AgentTeamService())
    server = grpc.aio.server(interceptors=[ApiKeyAuthInterceptor(os.environ['GRPC_API_KEY'])])
    chatbot_pb2_grpc.add_ChatbotServiceServicer_to_server(servicer, server)
    port = server.add_insecure_port('127.0.0.1:0')
    await server.start()
    print('VECTOR_NATIVE_READY ' + json.dumps({'port': port}), flush=True)
    try:
        await asyncio.to_thread(sys.stdin.readline)
    finally:
        host = servicer.background_rpc.host
        if host:
            for execution_id in list(host.supervisor.active):
                await host.supervisor.stop(execution_id)
        await server.stop(5)
        if host:
            await host.engine.dispose()
        from src.root_runtime import model_capacity
        if model_capacity._default:
            await model_capacity._default.engine.dispose()


if __name__ == '__main__':
    asyncio.run(main())
