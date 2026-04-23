"""
Internal Layout API Client for PPT-converted PDF support.

This client communicates with an internal layout detection gRPC service that
doesn't require PyMuPDF rendering, avoiding the "Invalid bandwriter header" errors
that occur with PPT-converted PDFs.
"""

import json
import logging
from dataclasses import dataclass
from typing import List, Optional

import grpc

from src.modules.logical_indexing.grpc import pp_pb2
from src.modules.logical_indexing.grpc import pp_pb2_grpc

logger = logging.getLogger(__name__)


@dataclass
class LayoutBox:
    """A single detected layout box from the internal API.

    Attributes:
        name: Layout label (e.g., "header", "footer", "text", "title")
        class_id: Numeric class identifier
        confidence: Detection confidence score (0-1)
        x1, y1, x2, y2: Bounding box coordinates in pixels
    """
    name: str
    class_id: int
    confidence: float
    x1: float
    y1: float
    x2: float
    y2: float


class ProtoMismatchError(Exception):
    """Raised when the proto response structure doesn't match expectations."""
    pass


class InternalLayoutClient:
    """Client for internal layout detection gRPC service.

    This gRPC service bypasses PyMuPDF rendering issues by accepting
    raw image bytes and returning layout detections.

    Proto definition (pp.proto):
        service ImageLayoutService {
          rpc DetectLayout (DetectRequest) returns (DetectResponse);
        }

        message DetectRequest {
          bytes image = 1;
        }

        message DetectResponse {
          repeated Detection detections = 1;
        }

        message Detection {
          string name = 1;
          int32 class = 2;
          float confidence = 3;
          float x1 = 4;
          float y1 = 5;
          float x2 = 6;
          float y2 = 7;
        }
    """

    def __init__(self, server_address: str = "173.208.208.93:3002"):
        """Initialize the client.

        Args:
            server_address: gRPC server address (host:port)
        """
        self.server_address = server_address
        self._channel = None
        self._stub = None

    def _connect(self):
        """Create gRPC channel and stub if not already connected."""
        if self._channel is None:
            self._channel = grpc.insecure_channel(self.server_address)
            self._stub = pp_pb2_grpc.ImageLayoutServiceStub(self._channel)

    def close(self):
        """Close the gRPC channel."""
        if self._channel is not None:
            self._channel.close()
            self._channel = None
            self._stub = None

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.close()

    def detect_layout(self, image_path: str) -> List[LayoutBox]:
        """Send image to internal gRPC API and return detected layout boxes.

        Args:
            image_path: Path to the image file to analyze

        Returns:
            List of LayoutBox objects with detected layouts

        Raises:
            grpc.RpcError: If the gRPC call fails
            ProtoMismatchError: If the response structure doesn't match expected proto
        """
        logger.info(f"Sending layout detection request to gRPC server at {self.server_address} for image: {image_path}")
        self._connect()

        # Read image file
        with open(image_path, "rb") as f:
            image_bytes = f.read()

        logger.debug(f"Read {len(image_bytes)} bytes from {image_path}")

        # Create request
        request = pp_pb2.DetectRequest(image=image_bytes)

        # Make gRPC call
        try:
            response = self._stub.DetectLayout(request, timeout=30)
            logger.debug(f"Received response from gRPC server")
        except grpc.RpcError as e:
            logger.error(f"gRPC Error: {e.code()} - {e.details()}")
            raise

        # Parse response - handle both old (JSON string) and new (protobuf) formats
        boxes = []

        # Try new protobuf format first
        if hasattr(response, 'detections'):
            for detection in response.detections:
                boxes.append(LayoutBox(
                    name=detection.name,
                    class_id=getattr(detection, 'class', 0),
                    confidence=detection.confidence,
                    x1=detection.x1,
                    y1=detection.y1,
                    x2=detection.x2,
                    y2=detection.y2,
                ))
        # Fallback: try old JSON string format
        elif hasattr(response, 'message') and response.message:
            try:
                data = json.loads(response.message)
                if isinstance(data, list) and len(data) > 0:
                    detections = data[0]
                    if isinstance(detections, list):
                        for item in detections:
                            boxes.append(LayoutBox(
                                name=item["name"],
                                class_id=item["class"],
                                confidence=item["confidence"],
                                x1=item["x1"],
                                y1=item["y1"],
                                x2=item["x2"],
                                y2=item["y2"],
                            ))
            except (json.JSONDecodeError, KeyError, TypeError) as e:
                raise ProtoMismatchError(
                    f"Response structure doesn't match expected proto format. "
                    f"Please regenerate stubs. Error: {e}"
                ) from e
        else:
            raise ProtoMismatchError(
                f"Unknown response structure. Has neither 'detections' nor 'message' field. "
                f"Response: {response}"
            )

        logger.debug(f"Detected {len(boxes)} layout boxes in {image_path}")
        return boxes

    def check_server_health(self) -> bool:
        """Check if the gRPC server is accessible.

        Returns:
            True if server is reachable, False otherwise
        """
        try:
            self._connect()
            # Try a simple call with empty data to check connectivity
            request = pp_pb2.DetectRequest(image=b"")
            self._stub.DetectLayout(request, timeout=5)
            return True
        except grpc.RpcError:
            return False
        finally:
            self.close()
