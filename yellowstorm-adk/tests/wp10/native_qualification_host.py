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
    os.environ['ENABLE_POSTGRESQL_LOGGING'] = 'false'
    import grpc
    from src.grpc_generated import chatbot_pb2_grpc
    from src.grpc_server.chatbot_servicer import ChatbotServicer
    from src.grpc_server.auth_interceptor import ApiKeyAuthInterceptor
    from src.root_runtime.background_host import BackgroundInvocationHost

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

    servicer = ChatbotServicer(None)
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
