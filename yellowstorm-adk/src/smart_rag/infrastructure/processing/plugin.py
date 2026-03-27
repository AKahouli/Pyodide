import copy
import uuid
from typing import Optional, Any

from google.adk.agents import InvocationContext
from google.adk.events import Event
from google.adk.plugins.base_plugin import BasePlugin
from google.genai import types
from google.genai.types import FunctionResponse, Content, Part
from typing_extensions import override


def make_empty_function_response_event(
        session,
        call_event: Event,
        *,
        response_dict: Optional[dict[str, any]] = None,
        will_continue: Optional[bool] = False,
        scheduling: Optional[Any] = None
) -> Event:
    """
    Given a call_event that contains a FunctionCall in one of its parts,
    create a new Event where that part is replaced by a FunctionResponse
    (empty or minimal response). Preserve metadata from the call where needed.
    """
    # Deep copy so we don’t mutate the original
    ev = copy.deepcopy(call_event)

    # Assign a new event ID
    ev.id = str(uuid.uuid4())

    # Assign a fresh timestamp right after the session's last update
    # Make sure you reference the session (self.session) and it has a last_update_time
    base = getattr(session, "last_update_time", None)

    ev.timestamp = base + 1e-6

    # Build new parts list
    new_parts = []
    for part in ev.content.parts:
        if getattr(part, "function_call", None) is not None:
            func_call = part.function_call
            # Build the response
            func_resp = FunctionResponse(
                id=func_call.id,
                name=func_call.name,
                response=response_dict if response_dict is not None else { 'result':'the user has stopped the request '},
                will_continue=will_continue,
                scheduling=scheduling,
                parts=None,
            )
            # Create a Part with the function_response
            new_part = Part(
                function_response=func_resp,
                text=getattr(part, "text", None),
                # You might also carry over `author`, etc. depending on your class
            )
        else:
            # This part wasn’t a function_call, keep as is
            new_part = part

        new_parts.append(new_part)

    # Replace content.parts
    ev.content = Content(parts=new_parts, role='user')

    return ev
async def clean_session_case_bad_request(invocation_context: InvocationContext, user_message) -> Optional[dict]:
    session = getattr(invocation_context, "session", None)
    session_service = getattr(invocation_context, "session_service", None)

    if not (session and getattr(session, "events", None)):
        return None

    events = session.events

    # Map all function_call IDs to detect missing responses
    calls = {}
    responses = set()

    for event in events:
        if not event.content or not hasattr(event.content, "parts"):
            continue
        for part in event.content.parts:
            if getattr(part, "function_call", None):
                calls[part.function_call.id] = event
            elif getattr(part, "function_response", None):
                responses.add(part.function_response.id)

    # Find calls with no response
    missing_ids = [fid for fid in calls if fid not in responses]
    if not missing_ids:
        return None

    # Only handle the most recent missing one
    missing_id = missing_ids[-1]
    call_event = calls[missing_id]

    # Check if we already created an empty response for it
    if any(
        getattr(p, "function_response", None)
        and getattr(p.function_response, "id", None) == missing_id
        for e in events
        if e.content and hasattr(e.content, "parts")
        for p in e.content.parts
    ):
        return None  # already has one

    empty_resp = make_empty_function_response_event(session, call_event)

    if session_service:
        await session_service.append_event(session, empty_resp)

    return None


def process_image_inputs(invocation_context: InvocationContext) -> None:
    """
    Process image_input from request and prepare for model injection.

    This function handles the image_input format from requests where images are
    provided with labels like: [{"image 1": "base64..."}, {"image 2": "base64..."}]
    and converts them to a format compatible with the image injection system.

    Args:
        invocation_context (InvocationContext): Context containing request data and state.
    """
    IMAGE_INPUT_KEY = "image_input"
    PROCESSED_IMAGES_KEY = "_pending_tool_images"
    FILENAMES_KEY = "_list_of_filenames"

    # Get state from invocation context
    state = getattr(invocation_context, "state", None)
    if not state:
        return

    # Convert state to dict if it has a to_dict method, otherwise treat as dict
    current_state = state.to_dict() if hasattr(state, "to_dict") else dict(state) if hasattr(state, "__iter__") else {}

    # Check if we have image_input to process
    if IMAGE_INPUT_KEY not in current_state or not current_state[IMAGE_INPUT_KEY]:
        return

    image_input = current_state[IMAGE_INPUT_KEY]

    # Validate image_input format
    if not isinstance(image_input, list):
        return

    # Process the image_input format: [{"image 1": "base64..."}, {"image 2": "base64..."}]
    processed_images = []
    file_names = []

    for image_dict in image_input:
        if not isinstance(image_dict, dict):
            continue

        for label, base64_data in image_dict.items():
            # Extract file extension from label if available, otherwise default to jpg
            if '.' in label:
                file_extension = label.split('.')[-1].lower()
                if file_extension in ['jpg', 'jpeg', 'png', 'gif', 'webp']:
                    mime_type = f"image/{file_extension}"
                else:
                    mime_type = "image/jpeg"  # default
            else:
                mime_type = "image/jpeg"

            # Store in the format expected by inject_images_before_model
            processed_images.append({
                "mime": mime_type,
                "data": base64_data
            })
            file_names.append(label)

    # Store in the state for the inject_images_before_model callback to use
    state[PROCESSED_IMAGES_KEY] = processed_images
    state[FILENAMES_KEY] = file_names

    # Clear the original image_input to prevent reprocessing
    state[IMAGE_INPUT_KEY] = []



class CleanSessionPlugin(BasePlugin):

    def __init__(self) -> None:
        """Initialize the plugin with counters."""
        super().__init__(name="on_user_message_callback")

    @override
    async def on_user_message_callback(
            self,
            *,
            invocation_context: InvocationContext,
            user_message: types.Content,
    ) -> Optional[types.Content]:
        """
        Called before a new message is processed.
        """
        await clean_session_case_bad_request(invocation_context, user_message)
        # Process image inputs
        process_image_inputs(invocation_context)

        return None
