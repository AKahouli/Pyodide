"""gRPC server initialization and startup logic."""

import grpc
import asyncio
from concurrent import futures
from structlog import get_logger

# Import generated protobuf code
try:
    from src.grpc_generated import chatbot_pb2_grpc
except ImportError:
    chatbot_pb2_grpc = None

from src.grpc_server.chatbot_servicer import ChatbotServicer
from src.dependencies import get_agent_team_service
from src.flow_engine.runtime.checkpointer import close_checkpointer, init_checkpointer

try:
    from src.grpc_generated import playbook_flow_pb2_grpc as pf_grpc
    from src.flow_engine.grpc_service import PlaybookFlowRuntimeServicer
except ImportError:
    pf_grpc = None
    PlaybookFlowRuntimeServicer = None

logger = get_logger(__name__)


async def start_grpc_server(host: str = "0.0.0.0", port: int = 50051) -> None:
    """
    Start the gRPC server for chatbot streaming.

    This server runs alongside FastAPI to provide gRPC endpoints for high-performance
    streaming. It uses the same business logic as the REST/SSE endpoints but delivers
    responses via gRPC with protobuf serialization.

    Args:
        host: Host address to bind the server (default: 0.0.0.0 for all interfaces)
        port: Port number for the gRPC server (default: 50051)

    Note:
        This function runs indefinitely until cancelled. It should be run as a
        background task when starting the FastAPI application.
    """
    if chatbot_pb2_grpc is None:
        logger.error(
            "[gRPC] Cannot start gRPC server: protobuf code not generated. "
            "Run 'python scripts/generate_proto.py' first."
        )
        return

    logger.info(f"[gRPC] Initializing gRPC server on {host}:{port}")

    # Create gRPC server with thread pool
    server = grpc.aio.server(
        futures.ThreadPoolExecutor(max_workers=10),
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

    if pf_grpc is not None and PlaybookFlowRuntimeServicer is not None:
        await init_checkpointer()
        pf_servicer = PlaybookFlowRuntimeServicer()
        pf_grpc.add_PlaybookFlowRuntimeServicer_to_server(pf_servicer, server)
        logger.info("[gRPC] PlaybookFlowRuntimeServicer registered")

    # Bind the server to port
    server.add_insecure_port(f'{host}:{port}')
    logger.warning(
        f"[gRPC] Server running in INSECURE mode on {host}:{port}. "
        "For production, use add_secure_port() with SSL certificates."
    )

    # Start the server
    await server.start()
    logger.info(f"✅ [gRPC] V2 Server started successfully on {host}:{port}")
    logger.info("[gRPC] Available services:")
    logger.info("  - chatbot.ChatbotService/RunAgentTeam (V2 streaming)")
    logger.info("  - chatbot.ChatbotService/GenerateConversationName (V2 unary)")
    logger.info("  - chatbot.ChatbotService/RunPlaybookWorkflow (unary)")
    logger.info("  - chatbot.ChatbotService/ResumePlaybookWorkflow (unary)")
    logger.info("  - chatbot.ChatbotService/RunStep (unary)")
    if pf_grpc is not None:
        logger.info("  - playbook_flow.PlaybookFlowRuntime/Run (streaming)")
        logger.info("  - playbook_flow.PlaybookFlowRuntime/Cancel (unary)")
        logger.info("  - playbook_flow.PlaybookFlowRuntime/ResumeApproval (unary)")
        logger.info("  - playbook_flow.PlaybookFlowRuntime/ResumeFromStep (unary)")

    # Keep the server running until terminated
    try:
        await server.wait_for_termination()
    except asyncio.CancelledError:
        logger.info("[gRPC] Server shutdown requested")
        await server.stop(grace=5)
        await close_checkpointer()
        logger.info("✅ [gRPC] Server stopped gracefully")
        raise


async def start_grpc_server_with_ssl(
    host: str,
    port: int,
    private_key_path: str,
    certificate_chain_path: str
) -> None:
    """
    Start the gRPC server with SSL/TLS encryption.

    This is the production-ready version that should be used in deployed environments.

    Args:
        host: Host address to bind the server
        port: Port number for the gRPC server
        private_key_path: Path to the private key file (.key)
        certificate_chain_path: Path to the certificate chain file (.crt)

    Example:
        await start_grpc_server_with_ssl(
            host="0.0.0.0",
            port=50051,
            private_key_path="/etc/ssl/private/server.key",
            certificate_chain_path="/etc/ssl/certs/server.crt"
        )
    """
    if chatbot_pb2_grpc is None:
        logger.error("[gRPC] Cannot start gRPC server: protobuf code not generated")
        return

    logger.info(f"[gRPC] Initializing SECURE gRPC server on {host}:{port}")

    # Read SSL certificate files
    try:
        with open(private_key_path, 'rb') as f:
            private_key = f.read()
        with open(certificate_chain_path, 'rb') as f:
            certificate_chain = f.read()
        logger.info("[gRPC] SSL certificates loaded successfully")
    except Exception as e:
        logger.error(f"[gRPC] Failed to load SSL certificates: {str(e)}", exc_info=True)
        raise

    # Create SSL server credentials
    server_credentials = grpc.ssl_server_credentials(
        [(private_key, certificate_chain)]
    )

    # Create gRPC server with thread pool
    server = grpc.aio.server(
        futures.ThreadPoolExecutor(max_workers=10),
        options=[
            ('grpc.max_send_message_length', 50 * 1024 * 1024),
            ('grpc.max_receive_message_length', 50 * 1024 * 1024),
            ('grpc.keepalive_time_ms', 10000),
            ('grpc.keepalive_timeout_ms', 5000),
            ('grpc.http2.max_pings_without_data', 0),
            ('grpc.http2.min_time_between_pings_ms', 10000),
            ('grpc.http2.min_ping_interval_without_data_ms', 5000),
            ('grpc.default_compression_algorithm', grpc.Compression.Gzip),
        ]
    )

    # Get service instances
    agent_team_service = get_agent_team_service()

    # Register servicer (V2 only)
    servicer = ChatbotServicer(agent_team_service=agent_team_service)
    chatbot_pb2_grpc.add_ChatbotServiceServicer_to_server(servicer, server)

    # Bind with SSL
    server.add_secure_port(f'{host}:{port}', server_credentials)
    logger.info(f"✅ [gRPC] SECURE server started on {host}:{port}")

    # Start and wait
    await server.start()
    try:
        await server.wait_for_termination()
    except asyncio.CancelledError:
        logger.info("[gRPC] Secure server shutdown requested")
        await server.stop(grace=5)
        logger.info("✅ [gRPC] Secure server stopped gracefully")
        raise
