import os
os.environ['GRPC_ALLOW_INSECURE'] = 'true'
from src.grpc_server.server import start_grpc_server
import asyncio

async def test():
    try:
        await start_grpc_server(host='0.0.0.0', port=50051)
    except Exception as e:
        print(f'Error: {e}')
        import traceback
        traceback.print_exc()

asyncio.run(test())