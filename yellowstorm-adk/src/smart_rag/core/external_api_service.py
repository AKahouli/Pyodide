"""External API service for handling specific brain_ids with streaming JSON wrapper pattern.

This service handles requests with specific brain_ids by redirecting them to an external API
and wrapping response chunks in JSON format.
"""

import asyncio
import base64
import json
import re
import time
import uuid
from typing import Dict, List, Any, Optional, Union, Tuple

import aiohttp

from src.config.settings import Settings
from src.logger.logging import get_logger
from src.schema.chatbot_schema import RunAgentTeamRequest, ChatWithADKRequest

logger = get_logger(__name__)


class CustomTextProcessor:
    """Processes :::customText chunks in streaming responses."""

    # Use pattern without DOTALL flag - re2 doesn't support it
    # Use [\s\S] instead of . to match any character including newlines
    CUSTOM_TEXT_PATTERN = re.compile(r':::customText\s*({[\s\S]*?})\s*:::')
    CUSTOM_IMAGE_PATTERN = re.compile(r':::customImage\s*({[\s\S]*?})\s*:::')
    CUSTOM_BASE64_LIST_PATTERN = re.compile(r'{\s*"base64"\s*:\s*"([A-Za-z0-9+/=]+)"\s*}')

    def __init__(self, brain_ids: Optional[List[str]] = None, settings: Optional[Settings] = None):
        self.reference_counter = 0
        self.pending_buffer = ""  # Buffer for handling split chunks
        self.sources = []  # List of extracted sources
        self.brain_ids = brain_ids or []
        self.settings = settings

    @property
    def _should_process_base64_lists(self) -> bool:
        """Check if base64 list processing is enabled for this brain_id."""
        if not self.settings or not self.brain_ids:
            return False
        enabled_ids = self.settings.BASE64_LIST_ENABLED_BRAIN_IDS
        return any(brain_id in enabled_ids for brain_id in self.brain_ids)

    def process_chunk(self, text: str, is_final: bool = False) -> Tuple[str, List[Dict[str, Any]]]:
        """Process individual chunks with state for handling split customText and customImage.

        Args:
            text: Current chunk text
            is_final: Whether this is the final chunk

        Returns:
            Tuple of (modified_text, list_of_sources_found_in_this_chunk)
        """
        sources = []

        # Add pending buffer to current text
        full_text = self.pending_buffer + text
        self.pending_buffer = ""

        # Find all customText, customImage, and base64 list matches
        text_matches = list(self.CUSTOM_TEXT_PATTERN.finditer(full_text))
        image_matches = list(self.CUSTOM_IMAGE_PATTERN.finditer(full_text))

        # Only add base64 list matches if enabled for this brain_id
        if self._should_process_base64_lists:
            base64_list_matches = list(self.CUSTOM_BASE64_LIST_PATTERN.finditer(full_text))
        else:
            base64_list_matches = []

        all_matches = text_matches + image_matches + base64_list_matches

        if not all_matches:
            # No matches, check if we have a partial match at the end
            if self._has_partial_custom_text(full_text):
                self.pending_buffer = self._extract_partial_custom_text(full_text)
                # Remove partial from return text
                modified_text = full_text[:-len(self.pending_buffer)]
            else:
                modified_text = full_text
            return modified_text, sources

        # Process complete matches (sort by position to maintain correct order)
        all_matches.sort(key=lambda m: m.start())
        modified_text = full_text
        offset = 0

        for match in all_matches:
            match_text = match.group(0)
            # Determine if this is a customImage or base64_list match by checking the matched text
            is_image = ':::customImage' in match_text
            is_base64_list = '"base64"' in match_text and ':::custom' not in match_text

            try:
                if is_base64_list:
                    # Direct base64 JSON pattern: decode to get a list of documents
                    base64_content = match.group(1)  # Extract base64 string
                    decoded_json = base64.b64decode(base64_content).decode('utf-8')
                    documents_list = json.loads(decoded_json)

                    # Validate it's a list
                    if not isinstance(documents_list, list):
                        logger.warning(f"[CUSTOM_BASE64_LIST] Decoded content is not a list, skipping")
                        # Remove invalid chunk
                        chunk_start = match.start() + offset
                        chunk_end = match.end() + offset
                        modified_text = modified_text[:chunk_start] + modified_text[chunk_end:]
                        offset -= len(match_text)
                        continue

                    # Track starting reference number for this batch
                    start_reference = self.reference_counter + 1

                    # Process each document in the list
                    for doc in documents_list:
                        self.reference_counter += 1
                        reference = f"[{self.reference_counter}]"

                        # Extract metadata from document structure
                        # Expected format: {"id": null, "metadata": {...}, "page_content": "...", "type": "Document"}
                        doc_metadata = doc.get('metadata', {})

                        source_data = {
                            'reference': reference,
                            'original_chunk': match_text,
                            'decoded_data': {
                                'source': doc_metadata.get('source', ''),
                                'external_id': doc_metadata.get('external_id', ''),
                                'brain_id': doc_metadata.get('brain_id', ''),
                                'page_content': doc.get('page_content', ''),
                                'page': doc_metadata.get('page', ''),
                                'type': doc.get('type', 'Document')
                            },
                            'type': 'text'
                        }
                        sources.append(source_data)
                        self.sources.append(source_data)

                    # Create numbered reference placeholders string like "[1] [2] [3]"
                    end_reference = self.reference_counter
                    reference_placeholders = ' '.join([f"[{i}]" for i in range(start_reference, end_reference + 1)])

                    # Replace the base64 JSON with reference placeholders
                    chunk_start = match.start() + offset
                    chunk_end = match.end() + offset
                    modified_text = modified_text[:chunk_start] + reference_placeholders + modified_text[chunk_end:]
                    offset += len(reference_placeholders) - len(match_text)

                    logger.debug(f"[CUSTOM_BASE64_LIST] Processed {len(documents_list)} documents, added references: {reference_placeholders}")

                else:
                    # customText and customImage: increment counter once per match
                    self.reference_counter += 1
                    reference = f"[{self.reference_counter}]"

                    # Extract and parse JSON
                    json_content = match.group(1)
                    chunk_data = json.loads(json_content)

                    if is_image:
                        # customImage: direct JSON, no base64 decoding
                        image_data = chunk_data
                        source_data = {
                            'reference': reference,
                            'original_chunk': match_text,
                            'decoded_data': image_data,
                            'type': 'image'
                        }
                        sources.append(source_data)
                        self.sources.append(source_data)

                        # Replace with reference in text
                        chunk_start = match.start() + offset
                        chunk_end = match.end() + offset
                        modified_text = modified_text[:chunk_start] + reference + modified_text[chunk_end:]
                        offset += len(reference) - len(match_text)

                        logger.debug(f"[CUSTOM_IMAGE] Processed chunk {reference} - path: {image_data.get('path', 'unknown')}")

                    elif 'base64' in chunk_data:
                        # customText: decode base64 content
                        base64_content = chunk_data['base64']
                        decoded_json = base64.b64decode(base64_content).decode('utf-8')
                        decoded_data = json.loads(decoded_json)

                        source_data = {
                            'reference': reference,
                            'original_chunk': match_text,
                            'decoded_data': decoded_data,
                            'type': 'text'
                        }
                        sources.append(source_data)
                        self.sources.append(source_data)

                        # Replace with reference in text
                        chunk_start = match.start() + offset
                        chunk_end = match.end() + offset
                        modified_text = modified_text[:chunk_start] + reference + modified_text[chunk_end:]
                        offset += len(reference) - len(match_text)

                        logger.debug(f"[CUSTOM_TEXT] Processed chunk {reference} - source: {decoded_data.get('source', 'unknown')}")
                    else:
                        logger.warning(f"[CUSTOM_TEXT] No base64 field found in chunk {reference}")

            except json.JSONDecodeError as e:
                logger.error(f"[CUSTOM_BLOCK] JSON parsing error for chunk {self.reference_counter}: {str(e)}")
                # Remove invalid chunk entirely
                chunk_start = match.start() + offset
                chunk_end = match.end() + offset
                modified_text = modified_text[:chunk_start] + modified_text[chunk_end:]
                offset -= len(match_text)
            except base64.binascii.Error as e:
                logger.error(f"[CUSTOM_BLOCK] Base64 decoding error for chunk {self.reference_counter}: {str(e)}")
                # Remove invalid chunk entirely
                chunk_start = match.start() + offset
                chunk_end = match.end() + offset
                modified_text = modified_text[:chunk_start] + modified_text[chunk_end:]
                offset -= len(match_text)
            except Exception as e:
                logger.error(f"[CUSTOM_BLOCK] Unexpected error processing chunk {self.reference_counter}: {str(e)}")
                # Remove invalid chunk entirely
                chunk_start = match.start() + offset
                chunk_end = match.end() + offset
                modified_text = modified_text[:chunk_start] + modified_text[chunk_end:]
                offset -= len(match_text)

        # Check for partial match at the end after processing
        if not is_final and self._has_partial_custom_text(modified_text):
            self.pending_buffer = self._extract_partial_custom_text(modified_text)
            modified_text = modified_text[:-len(self.pending_buffer)]
        elif is_final:
            # If this is the final chunk, don't leave any pending content
            self.pending_buffer = ""

        return modified_text, sources

    def _has_partial_custom_text(self, text: str) -> bool:
        """Check if text contains a partial customText, customImage, or base64 JSON at the end."""
        # Look for start of customText or customImage but no end
        has_custom_text = ':::customText' in text
        has_custom_image = ':::customImage' in text
        # Check for incomplete JSON object (starts with { but no closing })
        has_incomplete_json = text.rstrip().endswith('{') or (
            '{' in text and not text.rstrip().endswith('}') and
            '"base64"' in text
        )
        return (has_custom_text or has_custom_image or has_incomplete_json) and not text.rstrip().endswith(':::')

    def _extract_partial_custom_text(self, text: str) -> str:
        """Extract partial customText, customImage, or base64 JSON from the end of text."""
        # Find the last occurrence of either pattern
        custom_text_pos = text.rfind(':::customText')
        custom_image_pos = text.rfind(':::customImage')

        # Check for base64 JSON pattern
        base64_json_pos = text.rfind('{"base64"')
        if base64_json_pos == -1:
            base64_json_pos = text.rfind('{"base64')

        start_pos = max(custom_text_pos, custom_image_pos, base64_json_pos)
        return text[start_pos:]

    def finalize(self) -> List[Dict[str, Any]]:
        """Finalize processing and return any remaining sources."""
        # Clear any pending buffer
        self.pending_buffer = ""
        return self.sources.copy()

    def reset(self) -> None:
        """Reset processor state for new session."""
        self.reference_counter = 0
        self.pending_buffer = ""
        self.sources = []


class ExternalApiService:
    """Service for handling external API requests with streaming JSON wrapper pattern.

    Provides:
    - Request conversion from internal to external API format
    - Streaming response handling with JSON wrapping
    - Server-Sent Events formatting
    - Error handling and logging
    """

    def __init__(self, settings: Settings):
        """Initialize the ExternalApiService with configuration.

        Args:
            settings: Application settings containing external API configuration
        """
        self.settings = settings
        self.external_api_url = settings.EXTERNAL_API_URL
        self.bearer_token = None
        self.external_brain_ids = settings.EXTERNAL_API_BRAIN_IDS
        self.agent_name = settings.EXTERNAL_API_AGENT_NAME  # Will be updated per request
        self.brain_agent_mapping = settings.EXTERNAL_API_BRAIN_AGENT_MAPPING

        # Dynamic authentication configuration
        self.auth_url = settings.EXTERNAL_API_AUTH_URL
        self.auth_username = settings.EXTERNAL_API_USERNAME
        self.auth_password = settings.EXTERNAL_API_PASSWORD

        # Token caching
        self._cached_token = None
        self._token_expiry = 0
        self._token_cache_duration = 300  # 5 minutes cache duration

    def should_route_externally(self, brain_ids: Optional[List[str]]) -> bool:
        """Check if any brain_id in the request matches the external API configuration.

        Args:
            brain_ids: List of brain IDs from the request

        Returns:
            True if any brain_id should be routed externally, False otherwise
        """
        if not brain_ids or not self.external_brain_ids:
            return False

        # Check if any brain_id in the request matches the configured external brain_ids
        return any(brain_id in self.external_brain_ids for brain_id in brain_ids)

    def _get_agent_name_for_brain(self, brain_ids: Optional[List[str]]) -> str:
        """Get the appropriate agent name for the given brain IDs.

        Args:
            brain_ids: List of brain IDs from the request

        Returns:
            str: The agent name to use for this request
        """
        if not brain_ids:
            return self.agent_name

        # Find the first brain_id that has a mapping
        for brain_id in brain_ids:
            if brain_id in self.brain_agent_mapping:
                return self.brain_agent_mapping[brain_id]

        # If no specific mapping found, use the current agent name (default)
        return self.agent_name

    async def _get_authenticated_token(self) -> str:
        """Get an authenticated token for the external API.

        Uses dynamic authentication with username/password if configured,
        otherwise falls back to static bearer token.

        Returns:
            str: Authentication token for API requests

        Raises:
            ValueError: If authentication is not properly configured
            Exception: If authentication request fails
        """
        # Check if we should use dynamic authentication
        if self.auth_url and self.auth_username and self.auth_password:
            logger.debug("[EXTERNAL_API] Dynamic auth is configured, attempting authentication")
            # Check if cached token is still valid
            current_time = time.time()
            if (self._cached_token and self._token_expiry > current_time):
                logger.debug("[EXTERNAL_API] Using cached token")
                return self._cached_token

            # Get new token from auth endpoint
            return await self._authenticate_with_credentials()

        # Fall back to static bearer token
        if self.bearer_token:
            logger.debug("[EXTERNAL_API] Using static bearer token")
            return self.bearer_token

        raise ValueError("No authentication method configured. Either EXTERNAL_API_BEARER_TOKEN or dynamic auth credentials must be provided.")

    async def _authenticate_with_credentials(self) -> str:
        """Authenticate with external API using username and password.

        Returns:
            str: Authentication token

        Raises:
            Exception: If authentication request fails
        """
        logger.info(f"[EXTERNAL_API] Authenticating with credentials - URL: {self.auth_url}")

        # Validate that we have proper credentials
        if not self.auth_username or not self.auth_password:
            raise ValueError("Both username and password must be provided for dynamic authentication")

        auth_payload = {
            "username": self.auth_username,
            "password": self.auth_password
        }

        try:
            timeout = aiohttp.ClientTimeout(total=30)  # 30 second timeout for auth

            # Try with form data first, as many auth endpoints expect form-encoded data
            headers = {"Content-Type": "application/x-www-form-urlencoded"}
            form_data = aiohttp.FormData()
            form_data.add_field("username", self.auth_username)
            form_data.add_field("password", self.auth_password)

            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(self.auth_url, data=form_data, headers=headers) as response:
                    if response.status == 200:
                        # Parse response to get token
                        response_text = await response.text()

                        # Try to parse as JSON first
                        try:
                            response_data = await response.json()

                            # Try different token field names
                            token = None
                            for field in ["token", "access_token", "accessToken", "auth_token"]:
                                if field in response_data:
                                    token = response_data[field]
                                    break

                            if not token:
                                # If token not found in JSON fields, check if entire response is the token
                                if response_text.strip():
                                    token = response_text.strip()

                        except json.JSONDecodeError:
                            # If not JSON, use the entire response as token
                            token = response_text.strip() if response_text.strip() else None

                        if not token:
                            raise ValueError("No token found in authentication response")

                        # Cache the token
                        self._cached_token = token
                        current_time = time.time()
                        self._token_expiry = current_time + self._token_cache_duration

                        logger.info("[EXTERNAL_API] Authentication successful, token cached")
                        return token
                    else:
                        error_text = await response.text()
                        logger.error(f"[EXTERNAL_API] Authentication failed with status {response.status}: {error_text}")

                        # If form data fails, try JSON as fallback
                        logger.info("[EXTERNAL_API] Retrying with JSON payload...")
                        json_headers = {"Content-Type": "application/json"}

                        async with session.post(self.auth_url, json=auth_payload, headers=json_headers) as json_response:
                            if json_response.status == 200:
                                response_data = await json_response.json()

                                # Try different token field names
                                token = None
                                for field in ["token", "access_token", "accessToken", "auth_token"]:
                                    if field in response_data:
                                        token = response_data[field]
                                        break

                                if not token:
                                    # If token not found in JSON fields, check if entire response is the token
                                    response_text = await json_response.text()
                                    if response_text.strip():
                                        token = response_text.strip()

                                if not token:
                                    raise ValueError("No token found in authentication response")

                                # Cache the token
                                self._cached_token = token
                                current_time = time.time()
                                self._token_expiry = current_time + self._token_cache_duration

                                logger.info("[EXTERNAL_API] JSON Authentication successful, token cached")
                                return token
                            else:
                                json_error_text = await json_response.text()
                                logger.error(f"[EXTERNAL_API] JSON Authentication also failed with status {json_response.status}: {json_error_text}")
                                raise Exception(f"Authentication failed with both form data and JSON. Form error: HTTP {response.status} - {error_text}. JSON error: HTTP {json_response.status} - {json_error_text}")

        except aiohttp.ClientError as e:
            logger.error(f"[EXTERNAL_API] Authentication request failed: {str(e)}")
            raise Exception(f"Authentication request failed: {str(e)}")
        except json.JSONDecodeError as e:
            logger.error(f"[EXTERNAL_API] Failed to parse authentication response: {str(e)}")
            raise Exception(f"Failed to parse authentication response: {str(e)}")
        except Exception as e:
            logger.error(f"[EXTERNAL_API] Authentication error: {str(e)}")
            raise

    async def process_external_request(self, request: Union[RunAgentTeamRequest, ChatWithADKRequest], queue: asyncio.Queue[dict]) -> None:
        """Process a request using external API with streaming JSON wrapper pattern.

        Main entry point for external API workflow. Converts the request format,
        handles streaming responses, and wraps chunks in JSON format.

        Args:
            request: The agent team or chat request containing user prompt and configuration
            queue: AsyncIO queue for streaming response events back to client

        Raises:
            Exception: If external API request fails or streaming encounters errors
        """
        message_id = f"session-{uuid.uuid4()}"
        session_id = getattr(request, 'session_id', 'unknown')
        brain_ids = getattr(request, 'brain_ids', None)

        # Update self.agent_name based on this request's brain IDs
        self.agent_name = self._get_agent_name_for_brain(brain_ids)

        logger.info(f"[EXTERNAL_API] Starting external request processing - session_id: {session_id}, message_id: {message_id}, agent_name: {self.agent_name}")

        try:
            # Send initial description packet
            await self._send_description_packet(message_id, queue, request)

            # Convert request to external API format
            external_payload = self._convert_to_external_payload(request)
            headers = await self._create_headers()

            # Stream response from external API
            await self._stream_external_response(external_payload, headers, message_id, queue, brain_ids)

            logger.info(f"[EXTERNAL_API] External request completed successfully - session_id: {session_id}, message_id: {message_id}")

        except Exception as e:
            logger.error(f"[EXTERNAL_API] External request failed - session_id: {session_id}, message_id: {message_id}: {str(e)}")
            # Send error packet to maintain client experience
            error_packet = self._create_error_packet(message_id, str(e))
            await queue.put(self._format_sse_event(error_packet))
            raise

    def _convert_to_external_payload(self, request: Union[RunAgentTeamRequest, ChatWithADKRequest]) -> Dict[str, Any]:
        """Convert request to external API payload format.

        Maps the internal request schema to the external API expected format,
        preserving all relevant fields for the external service.

        Args:
            request: Internal request object (RunAgentTeamRequest or ChatWithADKRequest)

        Returns:
            Dictionary formatted for external API consumption
        """
        # Get common fields from both request types
        brain_ids = getattr(request, 'brain_ids', None)
        session_id = getattr(request, 'session_id', 'unknown')

        # For ChatWithADKRequest, get the message; for RunAgentTeamRequest, use default
        if hasattr(request, 'message'):
            message = request.message
        else:
            message = "hello"  # Default value

        # For ChatWithADKRequest, get max_tokens and other fields if available
        max_tokens = getattr(request, 'max_tokens', 512)
        top_k = getattr(request, 'top_k', 2)
        vectorstore_name = "vectorstore2"
        instructions = getattr(request, 'instructions', None)

        # Convert to external API payload format
        payload = {
            "metadata": {"additionalProp1": {}},
            "temperature": 0,
            "max_tokens": max_tokens,
            "max_retries": 6,
            "retrieval_qa_prompt": "string",
            "chatbot_name": "string",
            "conversation_id": session_id,
            "message": message,
            "top_k": top_k,
            "vectorstore_name": vectorstore_name,
            "instruction": instructions or "string",
            "brain_ids": brain_ids,
            "generate_standalone_question": "no_history",
            "enable_multilingual": False,
            "enable_rag_fusion": False,
            "mode": "string",
            "memory_k": 0,
            "conversation_prompt": (
                "Assistant is a large language model trained by OpenAI.\n\n"
                "Assistant is designed to be able to assist with a wide range of tasks, "
                "from answering simple questions to providing in-depth explanations and "
                "discussions on a wide range of topics. As a language model, Assistant is "
                "able to generate human-like text based on the input it receives, "
                "allowing it to engage in natural-sounding conversations and provide "
                "responses that are coherent and relevant to the topic at hand.\n\n"
                "Assistant is constantly learning and improving, and its capabilities are "
                "constantly evolving. It is able to process and understand large amounts "
                "of text, and can use this knowledge to provide accurate and informative "
                "responses to a wide range of questions.\n\n"
                "{history}\nHuman: {input}\nAssistant:"
            ),
            "strictness": 3,
            "graphml_path": "string",
            "chat_mode": "streaming",
            "rag_type": "AdvancedRag",
            "number_of_question": 1,
            "rewording_prompt": (
                "you have to decompose the following user query\n\n"
                "{question}\n\ninto multi-step query optimized to be used as rag query "
                "in order to facilitate the construction of a reasoning chain."
            ),
            "ai_generation_instruction": "string",
            "files": [
                {"file_name": "string", "file_path": "string", "created_at": "string"}
            ],
            "user_brains": ["string"],
            "mode_expert": False,
            "brain_documents": ["string"],
            "brains_relations": {"additionalProp1": {}},
            "languages": ["string"],
            "questionId": "string",
            "synonym_list": [{"additionalProp1": {}}],
            "search_web": "off",
            "user_instruction": "string",
            "isCache": "undefined"
        }

        logger.debug(f"[EXTERNAL_API] Converted request payload - session_id: {session_id}")
        return payload

    async def _create_headers(self) -> Dict[str, str]:
        """Create HTTP headers for external API request.

        Returns:
            Dictionary containing authentication and content type headers

        Raises:
            Exception: If authentication fails
        """
        token = await self._get_authenticated_token()
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream"  # Important for SSE or streaming APIs
        }

    async def _send_description_packet(self, message_id: str, queue: asyncio.Queue[dict], request: Union[RunAgentTeamRequest, ChatWithADKRequest]) -> None:
        """Send initial description packet to establish streaming session.

        Sends a packet with the user message and metadata to initialize
        the streaming session on the client side.

        Args:
            message_id: Unique identifier for this message session
            queue: AsyncIO queue for streaming response events
            request: The request object containing the user message
        """
        # Extract user message from request
        if hasattr(request, 'message'):
            user_message = request.message
        else:
            user_message = "|"  # Default value for RunAgentTeamRequest

        description_packet = {
            "agent_id": "no_id",
            "agent_name": self.agent_name,
            "agent_type": "agent",
            "chunk": user_message,
            "message_id": message_id,
            "message_type": "streaming",
            "content_type": "description",
            "chunk_order": 0,
            "chunk_id": str(uuid.uuid4())
        }

        logger.debug(f"[EXTERNAL_API] Sending description packet with user message - message_id: {message_id}, agent_name: {self.agent_name}")
        await queue.put(self._format_sse_event(description_packet))

    async def _stream_external_response(self, payload: Dict[str, Any], headers: Dict[str, str],
                                       message_id: str, queue: asyncio.Queue[dict],
                                       brain_ids: Optional[List[str]] = None) -> None:
        """Stream response from external API and wrap chunks in JSON format.

        Makes HTTP request to external API, streams the response, and wraps each
        chunk in the JSON format expected by the client.
        Enhanced to process :::customText chunks and replace them with numbered references.

        Args:
            payload: External API request payload
            headers: HTTP headers for the request
            message_id: Unique identifier for this message session
            queue: AsyncIO queue for streaming response events
            brain_ids: Brain IDs from the request for conditional processing

        Raises:
            Exception: If external API request fails or streaming encounters errors
        """
        chunk_order = 1
        custom_processor = CustomTextProcessor(brain_ids=brain_ids, settings=self.settings)
        all_sources = []

        # For base64 list processing: accumulate split base64 chunks
        base64_accumulator = []
        is_accumulating_base64 = False

        try:
            timeout = aiohttp.ClientTimeout(total=300)  # 5 minute timeout
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(self.external_api_url, headers=headers, json=payload) as response:
                    response.raise_for_status()

                    # Stream raw chunks and process for customText
                    chunks_received = 0
                    async for chunk in response.content.iter_chunked(16384):  # 16KB chunks for complete base64 JSON
                        if not chunk:
                            continue

                        chunks_received += 1

                        # Try to decode text, fallback to bytes representation
                        try:
                            text = chunk.decode("utf-8")
                        except UnicodeDecodeError:
                            text = repr(chunk)

                        # Skip empty chunks (servers sometimes send keep-alives)
                        if text.strip() == "":
                            continue

                        # === BASE64 JSON ACCUMULATION LOGIC ===
                        # Accumulates split base64 JSON chunks and combines them for processing
                        # ONLY for the direct {"base64":"..."} pattern after BEGIN_SOURCES

                        # Check if we should start accumulating (found {"base64": and not complete)
                        # But NOT if it's part of a :::customText or :::customImage block
                        if (not is_accumulating_base64
                                and '{"base64":' in text
                                and not '"}\n' in text
                                and ':::custom' not in text  # Don't accumulate if in custom block
                                and 'BEGIN_SOURCES' in text):  # Only accumulate after BEGIN_SOURCES
                            is_accumulating_base64 = True
                            base64_part = self._extract_base64_content(text)
                            base64_accumulator.append(base64_part)
                            continue

                        # If we're currently accumulating
                        if is_accumulating_base64:
                            # Check if this chunk ends the accumulation (has '"}\n' or 'END_OF_MESSAGE')
                            if '"}\n' in text or 'END_OF_MESSAGE' in text:
                                # This is the final chunk - extract the remaining base64 content
                                final_part = text
                                # Remove END_OF_MESSAGE suffix if present
                                if 'END_OF_MESSAGE' in final_part:
                                    final_part = final_part.split('END_OF_MESSAGE')[0]
                                # Remove trailing whitespace, '"}\n', etc.
                                final_part = final_part.strip().rstrip('"\n')
                                if final_part.endswith('}'):
                                    final_part = final_part[:-1]
                                # Extract content if this chunk also has the prefix
                                if '{"base64":' in final_part:
                                    final_part = self._extract_base64_content(final_part)

                                base64_accumulator.append(final_part)

                                # Combine all accumulated chunks into proper JSON
                                combined = '{"base64": "' + ''.join(base64_accumulator) + '"}'

                                # Reset accumulator and process the combined JSON
                                text = combined
                                base64_accumulator = []
                                is_accumulating_base64 = False
                            else:
                                # Still accumulating - extract this chunk's content
                                base64_part = self._extract_base64_content(text) if '{"base64":' in text else text
                                base64_accumulator.append(base64_part)
                                continue

                        # Clean chunk content by removing everything after BEGIN_SOURCES
                        # (preserves base64 JSON for enabled brain_ids)
                        cleaned_text = self._clean_chunk_content(text, brain_ids)

                        # Process chunk for custom patterns
                        modified_text, sources = custom_processor.process_chunk(cleaned_text, is_final=False)

                        # Store sources from this chunk
                        all_sources.extend(sources)

                        # Send the modified chunk if it has content
                        if modified_text.strip():
                            wrapped_chunk = self._create_streaming_packet(
                                modified_text, message_id, chunk_order, self.agent_name
                            )
                            logger.debug(f"[EXTERNAL_API] Streaming chunk {chunk_order} (processed customText) - message_id: {message_id}")
                            await queue.put(self._format_sse_event(wrapped_chunk))
                            chunk_order += 1

                    # Finalize processing to handle any remaining buffer
                    final_buffer_sources = custom_processor.finalize()
                    all_sources.extend(final_buffer_sources)

                    # Send source packets before final response
                    for source in all_sources:
                        source_packet = self._create_source_packet(source, message_id, chunk_order)
                        await queue.put(self._format_sse_event(source_packet))
                        chunk_order += 1

        except Exception as e:
            logger.error(f"[EXTERNAL_API] Enhanced streaming failed - message_id: {message_id}: {str(e)}")
            raise

        # Send final end_of_message packet
        await self._send_final_packet(message_id, chunk_order, queue)

        # Send None to signal end of stream (matching internal API pattern)
        await queue.put(None)

    async def _send_final_packet(self, message_id: str, chunk_order: int, queue: asyncio.Queue[dict]) -> None:
        """Send final packet to indicate streaming completion.

        Sends the "end_of_message" packet to signal the completion of the streaming session.

        Args:
            message_id: Unique identifier for this message session
            chunk_order: Order number for this final chunk
            queue: AsyncIO queue for streaming response events
        """
        final_packet = {
            "agent_id": "no_id",
            "agent_name": self.agent_name,
            "agent_type": "manager",
            "chunk": "end_of_message",
            "message_id": message_id,
            "message_type": "streaming",
            "content_type": "final_response",
            "chunk_order": chunk_order,
            "chunk_id": str(uuid.uuid4())
        }

        await queue.put(self._format_sse_event(final_packet))

    def _create_source_packet(self, source: Dict[str, Any], message_id: str, chunk_order: int) -> Dict[str, Any]:
        """Create a source packet for decoded customText or customImage content.

        Args:
            source: Dictionary containing reference, decoded_data, and type
            message_id: Unique identifier for this message session
            chunk_order: Order number for this packet

        Returns:
            Dictionary representing the source packet in streaming format
        """
        decoded_data = source['decoded_data']
        reference = source['reference']
        source_type = source.get('type', 'text')

        # Format according to type
        if source_type == 'image':
            # For images, use the decoded_data directly as content
            source_object = {
                "type": "image",
                "content": decoded_data
            }
        else:
            # For text, extract specific fields
            source_object = {
                "type": "text",
                "content": {
                    "source": decoded_data.get('source', ''),
                    "external_id": decoded_data.get('external_id', ''),
                    "brain_id": decoded_data.get('brain_id', ''),
                    "page_content": decoded_data.get('page_content', ''),
                    "page": decoded_data.get('page', '')
                }
            }

        source_packet = {
            'agent_id': 'no_id',
            'agent_name': self.agent_name,  # Use configured agent name
            'agent_type': 'agent',
            'chunk': json.dumps({
                'reference': reference,
                'object': source_object
            }, ensure_ascii=True),
            'chunk_id': str(uuid.uuid4()),
            'chunk_order': chunk_order,
            'content_type': 'source',
            'message_id': message_id,
            'message_type': 'streaming'
        }

        logger.debug(f"[EXTERNAL_API] Created source packet for {reference} (type: {source_type}) - message_id: {message_id}")
        return source_packet

    def _create_streaming_packet(self, chunk: str, message_id: str, chunk_order: int, agent_name: str) -> Dict[str, Any]:
        """Create a standard streaming packet.

        Args:
            chunk: The chunk content
            message_id: Unique identifier for this message session
            chunk_order: Order number for this chunk
            agent_name: Name of the agent sending this chunk

        Returns:
            Dictionary representing the streaming packet
        """
        return {
            "agent_id": "no_id",
            "agent_name": agent_name,
            "agent_type": "agent",
            "chunk": chunk,
            "message_id": message_id,
            "message_type": "streaming",
            "content_type": "chunk",
            "chunk_order": chunk_order,
            "chunk_id": str(uuid.uuid4())
        }

    def _create_error_packet(self, message_id: str, error_message: str) -> Dict[str, Any]:
        """Create error packet for streaming error responses.

        Creates a standardized error packet that maintains the same format
        as regular response packets for consistent client handling.

        Args:
            message_id: Unique identifier for this message session
            error_message: Description of the error that occurred

        Returns:
            Dictionary representing the error packet in streaming format
        """
        return {
            "agent_id": "no_id",
            "agent_name": self.agent_name,
            "agent_type": "agent",
            "chunk": f"Error: {error_message}",
            "message_id": message_id,
            "message_type": "error",
            "content_type": "error_response",
            "chunk_order": -1,
            "chunk_id": str(uuid.uuid4())
        }

    def _clean_chunk_content(self, text: str, brain_ids: Optional[List[str]] = None) -> str:
        """Clean chunk content by removing everything after BEGIN_SOURCES marker.

        For enabled brain_ids, extracts the base64 JSON after BEGIN_SOURCES and appends it
        to the text before sources (BEGIN_SOURCES itself is always removed).

        Args:
            text: Raw chunk text from the external API
            brain_ids: Brain IDs from the request for conditional base64 preservation

        Returns:
            Cleaned chunk text with BEGIN_SOURCES removed, optionally with base64 JSON preserved
        """
        # Check if we should preserve base64 JSON for enabled brain_ids
        preserve_base64 = (
            brain_ids
            and self.settings
            and any(bid in self.settings.BASE64_LIST_ENABLED_BRAIN_IDS for bid in brain_ids)
            and '{"base64":' in text
        )

        if 'BEGIN_SOURCES' not in text:
            return text

        begin_sources_pos = text.find('BEGIN_SOURCES')
        text_before_sources = text[:begin_sources_pos].rstrip()

        if preserve_base64:
            # Extract and append the base64 JSON
            after_sources = text[begin_sources_pos:]
            base64_start = after_sources.find('{"base64":')
            if base64_start != -1:
                json_part = after_sources[base64_start:].split('END_OF_MESSAGE')[0].rstrip()
                cleaned_text = text_before_sources + '\n' + json_part
                return cleaned_text

        return text_before_sources

    def _extract_base64_content(self, text: str) -> str:
        """Extract base64 content from text, removing the {"base64": " prefix and quotes.

        Args:
            text: Text containing {"base64": "..." pattern

        Returns:
            Extracted base64 content without prefix or quotes
        """
        # Split on {"base64": and take the part after it
        content = text.split('{"base64":', 1)[-1]
        content = content.strip()

        # Remove ': "' prefix if present
        if content.startswith(': "'):
            content = content[3:]

        # Remove leading quote if present
        if content.startswith('"'):
            content = content[1:]

        return content

    def _format_sse_event(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Format dictionary for Server-Sent Events.

        Returns the dictionary as-is to let the _event_stream function handle JSON formatting.
        This ensures consistent formatting between internal and external API responses.

        Args:
            data: Dictionary to format as SSE event

        Returns:
            Dictionary ready for SSE formatting
        """
        return data