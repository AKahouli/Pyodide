"""gRPC server initialization and startup logic."""

import grpc
from concurrent import futures
from structlog import get_logger

# Import generated protobuf code
try:
    from src.grpc_generated import chatbot_pb2_grpc
except ImportError:
    chatbot_pb2_grpc = None

from src.grpc_server.chatbot_servicer import ChatbotServicer
from src.grpc_server.auth_interceptor import ApiKeyAuthInterceptor
from src.grpc_server.credentials import build_server_credentials, resolve_api_key
from src.grpc_server.supervisor import FatalGrpcConfigurationError
from src.config.settings import get_settings
from src.dependencies import get_agent_team_service
from src.flow_engine.runtime.checkpointer import close_checkpointer, init_checkpointer

from src.grpc_generated import playbook_flow_pb2_grpc as pf_grpc
from src.flow_engine.grpc_service import PlaybookFlowRuntimeServicer

logger = get_logger(__name__)


async def start_grpc_server(
    host: str = "0.0.0.0",
    port: int = 50051,
    on_ready=None,
) -> None:
    """
    Start the gRPC server for chatbot streaming.

    This server runs alongside FastAPI to provide gRPC endpoints for high-performance
    streaming. It uses the same business logic as the REST/SSE endpoints but delivers
    responses via gRPC with protobuf serialization.

    Args:
        host: Host address to bind the server (default: 0.0.0.0 for all interfaces)
        port: Port number for the gRPC server (default: 50051)
        on_ready: Optional zero-argument callback invoked after the listener is
            actually bound and serving. Task creation alone is not readiness.

    Note:
        This function runs indefinitely until cancelled. It should be run as a
        background task when starting the FastAPI application.
    """
    if chatbot_pb2_grpc is None:
        # Fatal configuration error: retrying cannot help until the protobuf
        # stubs are generated. Surface instead of silently degrading.
        raise FatalGrpcConfigurationError(
            "Cannot start gRPC server: protobuf code not generated. "
            "Run 'python scripts/generate_proto.py' first."
        )

    logger.info(f"[gRPC] Initializing gRPC server on {host}:{port}")

    settings = get_settings()

    # Secure by default: validate TLS + API key before binding so any
    # misconfiguration fails loudly at startup instead of exposing an
    # unencrypted / unauthenticated channel.
    server_credentials = build_server_credentials(settings)
    api_key = resolve_api_key(settings)
    interceptors = []
    if api_key:
        interceptors.append(ApiKeyAuthInterceptor(api_key))
        logger.info("[gRPC] API-key authentication enabled")

    # Create gRPC server with thread pool
    server = grpc.aio.server(
        futures.ThreadPoolExecutor(max_workers=10),
        interceptors=interceptors,
        options=[
            # Maximum message sizes (50MB)
            ('grpc.max_send_message_length', 50 * 1024 * 1024),
            ('grpc.max_receive_message_length', 50 * 1024 * 1024),

            # Keepalive settings to prevent connection timeouts
            ('grpc.keepalive_time_ms', 10000),  # Send keepalive ping every 10s
            ('grpc.keepalive_timeout_ms', 5000),  # Wait 5s for ping ack
            ('grpc.http2.max_pings_without_data', 0),  # Allow unlimited pings
            ('grpc.http2.min_time_between_pings_ms', 10000),  # Min 10s between pings
            ('grpc.http2.min_ping_interval_without_data_ms', 5000),  # Min 5s without data

            # Enable compression
            ('grpc.default_compression_algorithm', grpc.Compression.Gzip),
        ]
    )

    # Get service instances (reuse existing dependency injection)
    try:
        agent_team_service = get_agent_team_service()
        logger.info("[gRPC] Agent team service initialized successfully")
    except Exception as e:
        logger.error(f"[gRPC] Failed to initialize service: {str(e)}", exc_info=True)
        raise

    # Create and register the servicer (V2 only)
    servicer = ChatbotServicer(agent_team_service=agent_team_service)

    chatbot_pb2_grpc.add_ChatbotServiceServicer_to_server(servicer, server)
    logger.info("[gRPC] ChatbotServicer registered")

    # A2A agent management (publish / rotate / enable / get)
    try:
        from src.grpc_generated import a2a_admin_pb2_grpc
        from src.grpc_server.a2a_admin_servicer import A2AAdminServicer

        a2a_admin_pb2_grpc.add_A2AAdminServiceServicer_to_server(
            A2AAdminServicer(), server
        )
        logger.info("[gRPC] A2AAdminServicer registered")
    except Exception as e:
        logger.error(f"[gRPC] Failed to register A2AAdminServicer: {e}", exc_info=True)

    await init_checkpointer()
    pf_servicer = PlaybookFlowRuntimeServicer()
    pf_grpc.add_PlaybookFlowRuntimeServicer_to_server(pf_servicer, server)
    logger.info("[gRPC] PlaybookFlowRuntimeServicer registered")

    # Agent Orchestrator (parallel multi-agent) — always registered.
    orchestrator_runtime = None
    try:
        from src.grpc_generated import companion_ai_pb2_grpc as orch_grpc
        from src.companion_ai.bootstrap import OrchestratorRuntime

        orchestrator_runtime = OrchestratorRuntime()
        await orchestrator_runtime.start()
        orch_grpc.add_CompanionAiServicer_to_server(
            orchestrator_runtime.servicer, server)
        from src.grpc_generated import companion_ai_pb2 as orch_pb
        svc = orch_pb.DESCRIPTOR.services_by_name["CompanionAi"]
        logger.info("[gRPC] CompanionAiServicer registered: %s [%s]",
                    svc.full_name,
                    ", ".join(m.name for m in svc.methods))
    except Exception as e:
        logger.error(f"[gRPC] Failed to start Agent Orchestrator: {e}", exc_info=True)
        # Do not leak a started runtime whose registration failed.
        if orchestrator_runtime is not None:
            try:
                await orchestrator_runtime.stop()
            except Exception as stop_error:
                logger.error(f"[gRPC] Failed to stop partially started orchestrator: {stop_error}")
        orchestrator_runtime = None

    # Bind the server to port. Secure by default (TLS); plaintext only under the
    # explicit GRPC_ALLOW_INSECURE opt-out (server_credentials is None then).
    if server_credentials is None:
        server.add_insecure_port(f'{host}:{port}')
        logger.warning(
            f"[gRPC] Server running INSECURE (GRPC_ALLOW_INSECURE) on {host}:{port}. "
            "Never use this in production."
        )
    else:
        server.add_secure_port(f'{host}:{port}', server_credentials)
        logger.info(f"[gRPC] TLS enabled — server certificate presented on {host}:{port}")

    # Start the server
    try:
        await server.start()
    except BaseException:
        if orchestrator_runtime is not None:
            try:
                await orchestrator_runtime.stop()
            except Exception as stop_error:
                logger.error(f"[gRPC] Failed to stop orchestrator after startup failure: {stop_error}")
        await close_checkpointer()
        raise
    logger.info(f"✅ [gRPC] V2 Server started successfully on {host}:{port}")
    # The listener is bound and serving: signal readiness to the supervisor.
    if on_ready is not None:
        try:
            on_ready()
        except Exception as ready_error:
            logger.error(f"[gRPC] on_ready callback failed: {ready_error}")
    logger.info("[gRPC] Available services:")
    logger.info("  - chatbot.ChatbotService/RunAgentTeam (V2 streaming)")
    logger.info("  - chatbot.ChatbotService/GenerateConversationName (V2 unary)")
    if pf_grpc is not None:
        logger.info("  - playbook_flow.PlaybookFlowRuntime/Run (streaming)")
        logger.info("  - playbook_flow.PlaybookFlowRuntime/Cancel (unary)")
        logger.info("  - playbook_flow.PlaybookFlowRuntime/ResumeApproval (unary)")
        logger.info("  - playbook_flow.PlaybookFlowRuntime/ResumeFromStep (unary)")
        logger.info("  - playbook_flow.PlaybookFlowRuntime/RunFromCheckpoint (streaming)")
    if orchestrator_runtime is not None:
        logger.info("  - yellowstorm.orchestrator.v1.CompanionAi "
                    "(CreateSession / RunTask / GetSession / StopSession / PauseSession"
                    " / DeliverMailReply) [%s]", orchestrator_runtime.describe())

    # Keep the server running until terminated
    try:
        await server.wait_for_termination()
    finally:
        logger.info("[gRPC] Server shutdown requested")
        await server.stop(grace=5)
        if orchestrator_runtime is not None:
            await orchestrator_runtime.stop()
        await close_checkpointer()
        logger.info("✅ [gRPC] Server stopped gracefully")
