"""Invocation-scoped MCP images for rebuilt ADK model requests."""
import base64
import hashlib

IMAGE_PREFIX = 'temp:_pending_tool_images_'
LABEL_PREFIX = 'temp:_list_of_filenames_'
TURN_KEY = 'temp:_tool_image_invocation_id'
CACHE_KEY = 'temp:_retained_tool_images'


def prepare_tool_image_turn(context):
    """Discard interrupted/previous turns before either producing or consuming images."""
    invocation_id = getattr(context, 'invocation_id', None)
    if not isinstance(invocation_id, str) or not invocation_id:
        return None
    if context.state.get(TURN_KEY) != invocation_id:
        for key in context.state.to_dict():
            if key.startswith((IMAGE_PREFIX, LABEL_PREFIX, '_pending_tool_images_', '_list_of_filenames_')):
                context.state[key] = []
        context.state[CACHE_KEY] = []
        context.state[TURN_KEY] = invocation_id
    return invocation_id


def retained_tool_image_batches(context, limit):
    invocation_id = prepare_tool_image_turn(context)
    retained = list(context.state.get(CACHE_KEY, [])) if invocation_id else []
    seen = {item['sha256'] for item in retained}
    dropped = 0
    for key, images in context.state.to_dict().items():
        prefix = next((p for p in (IMAGE_PREFIX, '_pending_tool_images_') if key.startswith(p)), None)
        if prefix is None:
            continue
        response_id = key[len(prefix):]
        label_key = (LABEL_PREFIX if prefix == IMAGE_PREFIX else '_list_of_filenames_') + response_id
        labels = context.state.get(label_key) or []
        for index, image in enumerate(images or []):
            digest = hashlib.sha256(base64.b64decode(image['data'])).hexdigest()
            if digest in seen:
                continue
            seen.add(digest)
            if len(retained) >= limit:
                dropped += 1
                continue
            retained.append({'response_id': response_id, 'image': image, 'sha256': digest,
                             'label': labels[index] if index < len(labels) else 'retrieved-image'})
        context.state[key] = []
        context.state[label_key] = []
    if invocation_id:
        context.state[CACHE_KEY] = retained
    batches = {}
    for item in retained:
        response_id = item['response_id']
        batches.setdefault(IMAGE_PREFIX + response_id, []).append(item['image'])
        batches.setdefault(LABEL_PREFIX + response_id, []).append(item['label'])
    return batches, dropped
