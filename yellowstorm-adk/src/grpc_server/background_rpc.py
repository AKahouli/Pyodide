"""Versioned background entry point; observers never own native task lifetime."""
import asyncio
import hmac
import importlib.metadata
import platform

import grpc
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from src.config.settings import get_settings
from src.grpc_generated import chatbot_pb2
from src.root_runtime.background_host import BackgroundInvocationHost
from src.root_runtime.background_sessions import BackgroundOwnershipError, BackgroundResumeRequired


class BackgroundRpc:
    def __init__(self, agent_team_service, component_converter):
        self.agent_team_service = agent_team_service
        self.host = None
        self.component_converter = component_converter
        self._lock = asyncio.Lock()

    async def capabilities(self):
        settings = get_settings()
        sdk = importlib.metadata.version('google-adk')
        response = chatbot_pb2.RootWorkCapabilitiesResponse(background_protocol_version=1,
            native_sdk_version=sdk, python_version=platform.python_version())
        if not (settings.ROOT_WORK_BACKGROUND_ENABLED and settings.ROOT_WORK_DATABASE_URL
            and settings.INTERNAL_SERVICE_SECRET and settings.GRPC_API_KEY and sdk == '2.11.0'
            and platform.python_version_tuple()[:2] == ('3', '12')):
            return response
        async with self._lock:
            if self.host is None:
                url = make_url(settings.ROOT_WORK_DATABASE_URL)
                if url.get_backend_name() != 'postgresql':
                    return response
                engine = create_async_engine(url.set(drivername='postgresql+asyncpg'), pool_size=5, max_overflow=5)
                self.host = BackgroundInvocationHost(engine, self.agent_team_service, self.component_converter)
        try:
            async with self.host.engine.connect() as connection:
                identity = (await connection.execute(text('SELECT instance_id FROM conversation.root_background_control_instance WHERE singleton=true'))).scalar_one()
                response.control_database_fingerprint = str(identity)
                response.background_ready = True
        except Exception:
            # Readiness is fail-closed; database/credential diagnostics stay out
            # of public capability responses.
            response.background_ready = False
        return response

    async def run(self, request, context):
        settings = get_settings()
        supplied = dict(context.invocation_metadata()).get('x-api-key', '')
        if not settings.GRPC_API_KEY or not hmac.compare_digest(str(supplied), settings.GRPC_API_KEY):
            await context.abort(grpc.StatusCode.UNAUTHENTICATED, 'Background caller authentication is required')
            return
        capability = await self.capabilities()
        if not capability.background_ready:
            await context.abort(grpc.StatusCode.FAILED_PRECONDITION, 'Background runtime is not qualified or enabled')
            return
        if request.control_database_fingerprint != capability.control_database_fingerprint:
            await context.abort(grpc.StatusCode.FAILED_PRECONDITION, 'Background control database does not match')
            return
        try:
            handle = await self.host.start(request)
            while not handle.task.done():
                yield chatbot_pb2.RootBackgroundInvocationUpdate(execution_id=request.execution_id, status='running')
                await asyncio.wait({handle.task}, timeout=5)
            await asyncio.shield(handle.task)
            yield chatbot_pb2.RootBackgroundInvocationUpdate(execution_id=request.execution_id, status=handle.status)
        except BackgroundResumeRequired:
            await context.abort(grpc.StatusCode.ABORTED, 'Existing native dispatch requires reconciliation')
        except BackgroundOwnershipError:
            await context.abort(grpc.StatusCode.ABORTED, 'Background ownership changed')
        except ValueError:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, 'Invalid owned background invocation')
        except Exception:
            await context.abort(grpc.StatusCode.UNAVAILABLE, 'Background dispatch requires owned reconciliation')
