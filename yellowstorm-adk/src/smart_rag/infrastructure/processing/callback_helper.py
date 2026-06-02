"""Callback helpers for Smart RAG agent operations.

This module provides callback functions for enhancing agent tool execution with
additional context, image handling, and structured response processing. It includes
functions for before-tool and after-tool callbacks in the Google ADK framework.

Functions:
    add_additional_context: Pre-tool callback for adding context to agent calls.
    get_structured_context: Formats session events into structured context.
    catch_images_after_tool: Post-tool callback for handling image responses.
    inject_images_before_model: Pre-model callback for injecting images into requests.
"""

import base64
import uuid
from typing import Optional, Dict, Any
from dataclasses import dataclass, field
from datetime import datetime, timezone
try:
    from google.genai import types
except Exception:  # pragma: no cover - optional dependency

    @dataclass
    class _Part:
        text: Optional[str] = None
        data: Optional[bytes] = None
        mime_type: Optional[str] = None

        @classmethod
        def from_bytes(cls, data: bytes, mime_type: str):
            return cls(data=data, mime_type=mime_type)

    @dataclass
    class _Content:
        role: Optional[str] = None
        parts: list = field(default_factory=list)

    @dataclass
    class _FunctionResponse:
        name: Optional[str] = None
        response: Any = None

    class _Types:
        Part = _Part
        Content = _Content
        FunctionResponse = _FunctionResponse

    types = _Types()
try:
    import re2 as re
except Exception:  # pragma: no cover - optional dependency
    import re

try:
    from google.adk.agents.callback_context import CallbackContext
    from google.adk.models import LlmRequest, LlmResponse
    from google.adk.tools import ToolContext, BaseTool
except Exception:  # pragma: no cover - optional dependency
    class CallbackContext:  # type: ignore[no-redef]
        pass

    class LlmRequest:  # type: ignore[no-redef]
        pass

    class LlmResponse:  # type: ignore[no-redef]
        pass

    class ToolContext:  # type: ignore[no-redef]
        pass

    class BaseTool:  # type: ignore[no-redef]
        pass

def add_timestamp_to_agent(callback_context: CallbackContext) -> Optional[dict]:
    """
    Adds UTC time in a JSON-serialisable format (ISO 8601 string).
    """
    current_state = callback_context.state.to_dict()

    if not current_state.get("time", None):
        utc_time = datetime.now(timezone.utc).isoformat()
        callback_context.state["time"] = utc_time
        return None


def append_suggested_agents(callback_context: CallbackContext) -> Optional[types.Content]:
    """
    Logs entry and initializes suggested agents state with deduplication.
    Stores existing suggestions to prevent duplication in the next response.
    """
    agent_name = callback_context.agent_name
    invocation_id = callback_context.invocation_id
    current_state = callback_context.state.to_dict()

    # Initialize suggested_agents if not present
    if not current_state.get("suggested_agents", None):
        callback_context.state["suggested_agents"] = []
    else:
        # Store existing suggestions for deduplication
        callback_context.state["last_suggested_agents"] = current_state.get("suggested_agents", [])

    return None

def modify_suggested_agents(callback_context: CallbackContext) -> Optional[types.Content]:
    """
    Handles agent exit and deduplicates suggested agents by name and description.
    Merges new suggestions with existing ones while preventing duplicates.
    """
    agent_name = callback_context.agent_name
    invocation_id = callback_context.invocation_id
    current_state = callback_context.state.to_dict()

    # Get existing and last suggested agents
    existing_agents = current_state.get("suggested_agents", [])
    last_agents = current_state.get("last_suggested_agents", [])

    # If we have last_suggested_agents, merge them with existing ones
    if last_agents:
        # Create a set of existing agent signatures to prevent duplicates
        existing_signatures = set()
        for agent in existing_agents:
            if isinstance(agent, dict):
                # Create a unique signature based on name and description
                name = agent.get("name", "").lower().strip()
                description = agent.get("description", "").lower().strip()
                signature = f"{name}|{description}"
                existing_signatures.add(signature)

        # Add new agents only if they don't already exist
        for agent in last_agents:
            if isinstance(agent, dict):
                name = agent.get("name", "").lower().strip()
                description = agent.get("description", "").lower().strip()
                signature = f"{name}|{description}"

                if signature not in existing_signatures:
                    existing_agents.append(agent)
                    existing_signatures.add(signature)

        # Update the state with deduplicated agents
        callback_context.state["suggested_agents"] = existing_agents
        callback_context.state["last_suggested_agents"] = existing_agents

    # Return None - the agent's output produced just before this callback will be used.
    return None

_MCP_SEARCH_STATE_KEYS = {
    "_mcp_search_user_id",
    "_mcp_search_workspace_id",
    "_mcp_search_file_names",
}

_MCP_SEARCH_PARAMS = {"user_id", "file_name", "workspace_id"}


def _get_mcp_tool_param_names(tool: BaseTool) -> set:
    raw = getattr(tool, "raw_mcp_tool", None)
    if raw is None:
        return set()
    schema = getattr(raw, "inputSchema", None) or {}
    return set((schema.get("properties") or {}).keys())


def _inject_mcp_search_context(
    tool: BaseTool, args: Dict[str, Any], tool_context: ToolContext
) -> None:
    state = tool_context.state.to_dict()
    if not state.get("_mcp_search_user_id"):
        return

    param_names = _get_mcp_tool_param_names(tool)
    if not param_names:
        return

    if not _MCP_SEARCH_PARAMS & param_names:
        return

    if "user_id" in param_names and "user_id" not in args:
        args["user_id"] = state["_mcp_search_user_id"]

    if "workspace_id" in param_names and "workspace_id" not in args:
        val = state.get("_mcp_search_workspace_id")
        if val:
            args["workspace_id"] = val

    if "file_name" in param_names and "file_name" not in args:
        val = state.get("_mcp_search_file_names")
        if val:
            args["file_name"] = val


async def add_additional_context(
    tool: BaseTool, args: Dict[str, Any], tool_context: ToolContext
) -> Optional[Dict]:
    """Add additional context to tool arguments before execution.
    
    Enhances agent tool calls by injecting structured context from previous
    conversation events. Manages task ordering for search agents and validates
    required arguments before execution.
    
    Key functionality:
    - Appends structured context from previous events to task descriptions
    - Ensures required arguments (expected_output, task_description) are present
    - Increments task_search_order counter for search agents
    - Blocks execution if validation fails
    - Cleans up context for search agents by removing source markers
    
    Args:
        tool (BaseTool): The tool being executed (typically a delegate function).
        args (Dict[str, Any]): Arguments passed to the tool, modified in-place.
        tool_context (ToolContext): Context containing session state and history.
        
    Returns:
        Optional[Dict]: None to proceed with execution, or Dict with error message
            to block execution if validation fails.
    """
    # Only process task_description if it exists
    if "task_description" in args and args.get("task_description"):
        args["task_description"] = args["task_description"] + "\n##original_expected_output##" + args.get("expected_output", "") + "##/original_expected_output##"

    # Check if this is a delegation function
    is_delegation_tool = tool.name.startswith("delegate_to_")

    if not is_delegation_tool:
        _inject_mcp_search_context(tool, args, tool_context)
        return None

    # Core logic for context injection and validation (delegation functions only)
    events=tool_context._invocation_context.session.events
    search_agent=False

    if tool.name.startswith("delegate_to_") and tool.name != "delegate_to_search_agent":
        agent_name = tool.name.replace('delegate_to_', '')
        if agent_name in ["search_agent"] and tool_context.state.get("has_search_agents", False):
            search_agent = True
        if agent_name not in ["search_agent",'operator_agent'] and tool_context.state.get("has_search_agents", False):
            counter = tool_context.state.get("task_search_order", 0)
            counter += 1
            tool_context.state["task_search_order"] = counter
            args["expected_output"] = counter

    # Legacy support for direct delegate_to_search_agent calls
    elif tool.name == "delegate_to_search_agent":
        search_agent = True
        counter = tool_context.state.get("task_search_order", 0)
        counter += 1
        tool_context.state["task_search_order"] = counter
        args["expected_output"] = counter

    if "expected_output" not in args:
        return {"result": "Tool execution was blocked by before_tool_callback because missing expected_output "
                          "argument ."}
    elif "task_description" not in args:
        return {"result": "Tool execution was blocked by before_tool_callback because missing "
                          "task_description_argument."}

    ch=f"""
    < task_description > {args['task_description']} <\ task_description> < expected_output >
     {args["expected_output"]} <\ expected_output>
    """
    args["task_description"] = ch + get_structured_context(events, search_agent=search_agent)

    return None

def get_structured_context(events: list,search_agent: Optional[bool] = False) -> str:
    """Get structured context for the user request.
    
    Processes session events to create structured context that agents can use
    to understand previous interactions and maintain continuity across tasks.
    
    Args:
        events (list): List of session events from the conversation history.
        search_agent (Optional[bool]): Whether the context is for a search agent.
            If True, removes source markers from the context.
            
    Returns:
        str: Formatted additional context string containing structured event
            information wrapped in XML-like tags for agent consumption.
    """
    # Prettify the events
    formatted_events = []
    for event in events:
        # Access the event parts and text
        event_details = ""
        # Event Author

        # Process each part in the event (if there are multiple parts)
        if event.content and event.content.parts:
            for i, part in enumerate(event.content.parts):
                if hasattr(part, 'function_response') and part.function_response:
                    func_name = part.function_response.name
                    author = func_name.replace("delegate_to_", "")
                    event_details += f" {part.function_response.response.get('result', '')}\n"
                    if search_agent:
                        event_details= re.sub(r"§task_\d+§(image|text) .*?§", "", event_details)
                    event_strings = f" <{author}> {event_details} </{author}> "

                    formatted_events.append(f"<event>\n{event_strings}</event>\n")

    # Now combine the structured context with the query, expected output, and the formatted events
    additional_context = f"<additional_context>\n{formatted_events}\n</additional_context>"
    return additional_context

def catch_images_after_tool(
            tool: BaseTool,
            args: dict,  # ADK passes this positional‑or‑keyword
            tool_context: ToolContext,
            tool_response: dict  # **required keyword**
    ) -> Optional[str]:
        """Capture image Parts, redact them from JSON, keep everything else.
        
        Post-processing callback for search tools that handles mixed media responses
        by separating images from text sources and managing proper ordering for
        citation and reference purposes.
        
        Functionality:
        - Extracts images from search responses and stores them in context state
        - Processes text sources with sequential ordering indices
        - Maintains text_order counter across multiple tool calls
        - Returns cleaned text sources for agent processing
        - Buffers images for later injection into model requests

        Args:
            tool (BaseTool): The search tool that was executed.
            args (dict): The arguments that were passed to the tool.
            tool_context (ToolContext): Context containing state and session info.
            tool_response (dict): Raw response from the search tool execution.
            
        Returns:
            Optional[str]: String representation of cleaned text sources with
                ordering information, or None if not a search tool.
        """


        if tool.name in ["perform_document_search","perform_standard_search"]:
            images = []
            returned_text_sources = []
            if "text_order" not in tool_context.state:
                tool_context.state["text_order"] = 0

            text_order = tool_context.state["text_order"]


            cleaned = tool_response.get("sources_text", [])
            images= tool_response.get("sources_image", [])
            response_id= str(tool_response.get("response_id", uuid.uuid4()))

            if images:
                pending_tool_images_key = f"_pending_tool_images_{response_id}"
                list_of_filenames_key = f"_list_of_filenames_{response_id}"
                tool_context.state[pending_tool_images_key] = images  # buffer for this turn
                tool_context.state[list_of_filenames_key] = tool_response.get("list_of_filenames")
                print(f"images buffered: {list_of_filenames_key} {pending_tool_images_key} for response_id {response_id}")

            for source in cleaned:
                text_order += 1
                returned_text_sources.append(source)

            tool_context.state["text_order"] = text_order
            return str(returned_text_sources)  # let the agent continue with the cleaned payload

def inject_images_before_model(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> Optional[LlmResponse]:
    """Inject images into LLM request before model execution.

    Pre-model callback that retrieves buffered images from tool execution and
    injects them into the LLM request so the model can process visual content
    alongside text responses. Handles multiple parallel tool calls by looping
    over all state keys that start with the image and filename prefixes.

    Args:
        callback_context (CallbackContext): Context containing state with buffered images.
        llm_request (LlmRequest): The request to the language model, modified in-place.

    Returns:
        Optional[LlmResponse]: None to proceed with normal model execution.

    Note:
        Images are cleared from the buffer after injection to prevent
        duplicate processing in subsequent requests.
    """
    IMAGE_KEY_PREFIX = "_pending_tool_images_"
    FILENAME_KEY_PREFIX = "_list_of_filenames_"

    def detect_mime_type(image_bytes, provided_mime=None):
        """Detect MIME type from image bytes data."""
        try:
            # Check image signatures
            if image_bytes.startswith(b'\xFF\xD8\xFF'):
                return 'image/jpeg'
            elif image_bytes.startswith(b'\x89PNG\r\n\x1a\n'):
                return 'image/png'
            elif image_bytes.startswith(b'GIF87a') or image_bytes.startswith(b'GIF89a'):
                return 'image/gif'
            elif image_bytes.startswith(b'RIFF') and b'WEBP' in image_bytes[:12]:
                return 'image/webp'
            elif image_bytes.startswith(b'II*\x00') or image_bytes.startswith(b'MM\x00*'):
                return 'image/tiff'
            else:
                # Default to the provided mime type or png if unknown
                return provided_mime or 'image/png'
        except Exception:
            # If detection fails, return the provided mime type or default
            return provided_mime or 'image/png'

    def unwrap_images(wrapped):
        """
        wrapped : [{"mime": "...", "data": "<base64 str>"}]
        returns : [types.Part(...), ...]      # ready for Gemini / your SDK
        """
        parts = []
        for img in wrapped:
            # Decode base64 to get raw bytes
            raw = base64.b64decode(img["data"])
            # Detect the actual MIME type from the decoded bytes (NOT the base64 string)
            detected_mime = detect_mime_type(raw, img.get("mime"))
            parts.append(types.Part.from_bytes(data=raw, mime_type=detected_mime))
        return parts

    # Get all state keys
    state_dict = callback_context.state.to_dict()

    # Find all keys that start with the prefixes
    image_keys = [key for key in state_dict.keys() if key.startswith(IMAGE_KEY_PREFIX)]

    # Process each set of images with their corresponding filenames
    for image_key in image_keys:
        # Extract the response_id suffix from the image key
        response_id = image_key.replace(IMAGE_KEY_PREFIX, "")
        filename_key = FILENAME_KEY_PREFIX + response_id

        # Get images and filenames for this response_id
        images = callback_context.state.get(image_key, [])
        file_names = callback_context.state.get(filename_key, [])

        # Ensure file_names is a list (defensive check)
        if file_names is None:
            file_names = []

        if images:
            # Unwrap the images
            unwrapped_images = unwrap_images(images)

            # Inject each image with its filename
            for i, image in enumerate(unwrapped_images):
                # Use filename if available, otherwise use a default
                filename = f"source_reference: {file_names[i]} \n\n, below is the retrieved image context: \n"
                llm_request.contents.append(
                    types.Content(
                        role="user",
                        parts=[types.Part(text=filename)] + [image]
                    )
                )

            # Clear the buffer for this response_id
            callback_context.state[image_key] = []
            if filename_key in state_dict:
                callback_context.state[filename_key] = []

    return None

try:
    import re2
except Exception:  # pragma: no cover - optional dependency
    import re as re2

try:
    from bs4 import BeautifulSoup
except Exception:  # pragma: no cover - optional dependency
    class BeautifulSoup:  # type: ignore[no-redef]
        def __init__(self, html: str, parser: str):
            self._html = html

        def find(self, tag: str):
            return None

        def __str__(self):
            return self._html

def extract_html(result):
    result = str(result)

    # 1) If the html is inside a Markdown code fence, pull its content first
    m = re2.search(
        r'(?is)```(?:html)?\s*(.*?)\s*```',
        result
    )
    if m:
        candidate = m.group(1).strip()
    else:
        candidate = result

    # 2) Try to extract <!doctype ...><html>...</html> or <html>...</html>
    m = re2.search(
        r'(?is)(?:<!doctype[^>]*>\s*)?<html\b[^>]*>.*?</html>',
        candidate
    )
    if m:
        return m.group(0).strip()

    # 3) If no <html> tag, maybe the response is only a fragment
    m = re2.search(
        r'(?s)<[a-zA-Z][^>]*>.*',
        candidate
    )
    if m:
        fragment = m.group(0).strip()
        soup = BeautifulSoup(fragment, "html.parser")

        html_tag = soup.find("html")
        if html_tag:
            return str(html_tag)

        return str(soup).strip()

    # 4) Fallback
    return ""



async def add_diagram_context_before_tool(
    tool: BaseTool, args: Dict[str, Any], tool_context: ToolContext
) -> Optional[Dict]:
    """Add calling agent context to diagram agent tool arguments before execution.

    Pre-tool callback for diagramAgent (HtmlAgent) that injects structured context
    from the parent agent's conversation history. This allows the diagram agent to
    understand the full conversation context when generating diagrams.

    Functionality:
    - Detects when HtmlAgent (diagram tool) is being called
    - Extracts structured context from previous conversation events
    - Injects the context into the task_description argument
    - Preserves the original task description while adding context

    Args:
        tool (BaseTool): The tool being executed (should be HtmlAgent/delegation tool).
        args (Dict[str, Any]): Arguments passed to the tool, modified in-place.
        tool_context (ToolContext): Context containing session state and history.

    Returns:
        Optional[Dict]: None to proceed with execution.
    """
    # Only apply to diagram agent calls (HtmlAgent delegation tools)
    if not (tool.name and "HtmlAgent" in tool.name):
        return None

    # Get session events for context
    events = tool_context._invocation_context.session.events

    # Get structured context from previous events
    additional_context = get_structured_context(events, search_agent=False)

    # Get the calling agent's name
    calling_agent = tool_context.agent_name

    # Inject context into task_description if it exists
    if "request" in args:
        original_task = args["request"]
        args["request"] = f"""{original_task}

<context_from_calling_agent>
You are being called by agent: {calling_agent}

Here is the relevant context from the conversation that may help you create a better diagram:
{additional_context}
</context_from_calling_agent>
"""
    return None


async def catch_diagram_after_tool(
    tool: BaseTool,
    args: dict,
    tool_context: ToolContext,
    tool_response: dict
) -> Optional[dict]:
    """Capture HTML diagram responses and replace with reference IDs.

    Post-processing callback for diagram tools that intercepts HTML diagram
    outputs, stores them in the global reference tracker, and returns reference
    IDs instead of the actual HTML content.

    Functionality:
    - Detects HTML diagram responses from diagramming agents
    - Stores HTML content in the DiagramReferenceTracker with session context
    - Generates sequential reference IDs in format [diagram_N]
    - Returns modified response with reference instead of raw HTML
    - Preserves diagram metadata for later retrieval

    Args:
        tool (BaseTool): The tool that was executed (diagramming agent).
        args (dict): Arguments that were passed to the tool.
        tool_context (ToolContext): Context containing state and session info.
        tool_response (dict): Raw response from the diagramming tool.

    Returns:
        Optional[dict]: Modified response with reference ID instead of HTML,
            or None if not a diagram tool.
    """
    # Check if this is a diagramming agent tool
    if not (tool.name and "HtmlAgent" in tool.name):
        return None

    # Get the response content
    result = extract_html(tool_response)

    # Check if the response contains HTML content
    if not result or not isinstance(result, str):
        return None

    # Simple HTML detection - look for HTML tags
    is_html = bool(re.search(r'<[^>]+>', result))
    if not is_html:
        return None

    # Import here to avoid circular imports
    from ...infrastructure.diagram.reference_tracker import _global_diagram_tracker

    # Get session ID from tool context
    session_id = getattr(tool_context._invocation_context.session, 'id', 'default')

    # Initialize reference tracker if not present
    if "_diagram_reference_tracker" not in tool_context.state:
        tool_context.state["_diagram_reference_tracker"] =_global_diagram_tracker

    reference_tracker = tool_context.state["_diagram_reference_tracker"]

    # Get next reference number
    reference_num = await reference_tracker.get_next_reference(session_id)

    # Extract diagram request from args for metadata
    diagram_request = args.get("task_description", "Unknown diagram request")

    # Store the diagram
    await reference_tracker.store_diagram(
        session_id=session_id,
        reference=reference_num,
        html_content=result,
        diagram_request=diagram_request,
        title=f"Diagram {reference_num}"
    )

    # Return the reference instead of the HTML
    reference_tag = f"[diagram_{reference_num}]"
    return {"result": f"to reference the successfully generated diagram you can use this reference {reference_tag}"}
