import copy
import uuid
from typing import Any, Optional

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
        response_dict: Optional[dict[str, Any]] = None,
        will_continue: Optional[bool] = False,
        scheduling: Optional[Any] = None,
        call_ids: Optional[set[str]] = None,
) -> Event:
    """
    Given a call_event that contains a FunctionCall in one of its parts,
    create a new Event where that part is replaced by a FunctionResponse
    (empty or minimal response). Preserve metadata from the call where needed.
    """
    # Deep copy so we don't mutate the original event or its metadata.
    ev = copy.deepcopy(call_event)

    # Assign a new event ID
    ev.id = str(uuid.uuid4())

    # Keep recovery responses ordered after the latest persisted event.
    base = getattr(session, "last_update_time", None) or ev.timestamp
    ev.timestamp = base + 1e-6

    # Build new parts list
    new_parts = []
    for part in ev.content.parts:
        func_call = getattr(part, "function_call", None)
        if func_call is None or (call_ids is not None and func_call.id not in call_ids):
            continue
        func_resp = FunctionResponse(
            id=func_call.id,
            name=func_call.name,
            response=response_dict if response_dict is not None else {
                "error": "The previous tool call was interrupted and is no longer available."
            },
            will_continue=will_continue,
            scheduling=scheduling,
            parts=None,
        )
        new_parts.append(Part(function_response=func_resp))

    # Replace content.parts
    ev.content = Content(parts=new_parts, role='user')

    return ev


def _function_response_ids(events) -> set[str]:
    return {
        part.function_response.id
        for event in events
        if event.content and hasattr(event.content, "parts")
        for part in event.content.parts
        if getattr(part, "function_response", None)
    }


async def _append_recovery_response(
        invocation_context: InvocationContext,
        session,
        call_event: Event,
        missing_ids: set[str],
):
    session_service = invocation_context.session_service
    outstanding_ids = missing_ids - _function_response_ids(session.events)
    while outstanding_ids:
        response_event = make_empty_function_response_event(
            session,
            call_event,
            call_ids=outstanding_ids,
        )
        try:
            await session_service.append_event(session, response_event)
            return session
        except ValueError:
            get_session = getattr(session_service, "get_session", None)
            if not callable(get_session):
                raise

            refreshed = await get_session(
                app_name=session.app_name,
                user_id=session.user_id,
                session_id=session.id,
            )
            if refreshed is None:
                raise

            previous_revision = getattr(session, "_storage_update_marker", None)
            current_revision = getattr(refreshed, "_storage_update_marker", None)
            if previous_revision == current_revision:
                raise

            session = refreshed
            invocation_context.session = refreshed
            outstanding_ids -= _function_response_ids(refreshed.events)

    return session


async def clean_session_case_bad_request(invocation_context: InvocationContext, user_message) -> Optional[dict]:
    session = getattr(invocation_context, "session", None)
    session_service = getattr(invocation_context, "session_service", None)

    if not (session and getattr(session, "events", None)):
        return None

    events = session.events

    # Keep event order so parallel dangling calls are reconciled deterministically.
    calls = []
    responses = set()

    for event in events:
        if not event.content or not hasattr(event.content, "parts"):
            continue
        for part in event.content.parts:
            if getattr(part, "function_call", None):
                calls.append((part.function_call.id, event))
            elif getattr(part, "function_response", None):
                responses.add(part.function_response.id)

    missing_by_event = {}
    for call_id, event in calls:
        if call_id not in responses:
            missing_by_event.setdefault(id(event), (event, set()))[1].add(call_id)

    if not missing_by_event:
        return None

    if session_service:
        active_session = session
        for call_event, missing_ids in missing_by_event.values():
            active_session = await _append_recovery_response(
                invocation_context,
                active_session,
                call_event,
                missing_ids,
            )

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
