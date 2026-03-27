# Web Sources Implementation - Summary

## Overview
This implementation captures web search sources from the LinkUp API and streams them as a separate component to the frontend, without affecting agent behavior.

## Implementation Strategy

### Key Idea
When `perform_web_search` function is called:
1. Return dict with `{"text": "...", "sources": [...]}`
2. Agent receives the full response (behavior unchanged - sees both text and sources)
3. When function_response is detected, extract sources and stream as separate component

## Changes Made

### 1. Proto Schema Update (`proto/chatbot.proto`)

Added new component types:
```protobuf
message SourceItem {
    string title = 1;  // Source title (e.g., "Wikipedia.org")
    string url = 2;    // Source URL
}

message SourcesComponent {
    repeated SourceItem sources = 1;  // List of web sources
}

// Added to Component message:
SourcesComponent sources = 11;
```

### 2. WebSearchTool (`src/smart_rag/tools/search/web_search.py`)

**Changed return type** from `str` to `Dict`:
```python
async def web_search(self, query: str, search_web: str = "standard") -> Dict:
    # ... LinkUp API call ...

    # Format text response for agent
    text_response = self._format_search_response(res)

    # Extract structured sources
    sources = self._extract_sources(res, query)

    # Return both
    return {
        "text": text_response,
        "sources": sources
    }
```

**Added helper method** `_extract_sources`:
```python
def _extract_sources(self, response, query: str) -> List[Dict[str, str]]:
    sources = []
    for source_url in response.sources:
        parsed = urlparse(source_url)
        domain = parsed.netloc.replace('www.', '')
        title = domain.split('.')[0].capitalize()

        sources.append({
            "title": title + ".org" if ".org" in domain else title + ".com",
            "url": source_url
        })
    return sources
```

### 3. SearchToolkit (`src/smart_rag/tools/search/toolkit.py`)

**Updated return type** to pass through dict:
```python
async def perform_web_search(self, query: str) -> Dict:
    if not self.web_search_tool:
        return {"text": "Web search is not enabled.", "sources": []}

    result = await self.web_search_tool.perform_web_search(query)
    logger.info(f"[WEB SEARCH] Query: {query}, Sources: {len(result.get('sources', []))}")
    return result
```

### 4. Streaming Processor (`src/smart_rag/engines/multi_agent/streaming_processor.py`)

**Added handler** for perform_web_search function response:
```python
elif part.function_response:
    func_name = part.function_response.name
    # ... existing handlers ...
    if func_name == "perform_web_search" and q:
        await self._handle_web_search_response(part.function_response, current_message_id, q)
```

**New method** to extract and stream sources:
```python
async def _handle_web_search_response(self, function_response, message_id: str, q: asyncio.Queue[dict]) -> None:
    response_data = function_response.response

    if isinstance(response_data, dict) and 'sources' in response_data:
        sources = response_data.get('sources', [])

        if sources:
            sources_chunk = self.streaming_formatter.format_component_event(
                agent_id="manager",
                component_type="sources",
                component_data={"sources": sources},
                message_id=message_id
            )
            await q.put(sources_chunk)
            logger.info(f"[WEB SEARCH] Successfully streamed {len(sources)} web sources")
```

### 5. gRPC Servicer (`src/grpc_server/chatbot_servicer.py`)

**Serialize sources component**:
```python
elif component_type == "sources":
    source_items = []
    for source_data in component_data.get("sources", []):
        source_items.append(chatbot_pb2.SourceItem(
            title=source_data.get("title", ""),
            url=source_data.get("url", "")
        ))
    component_kwargs["sources"] = chatbot_pb2.SourcesComponent(
        sources=source_items
    )
```

**Added logging**:
```python
elif component.get("type") == "sources":
    sources = sources_data.get("sources", [])
    print(f"🔗 [gRPC] Sending SOURCES component to client:")
    print(f"   - number of sources: {len(sources)}")
    for idx, source in enumerate(sources):
        print(f"   - [{idx+1}] {source.get('title')} - {source.get('url')}")
```

### 6. Proxy Server (`grpc_proxy_server.py`)

**Convert sources component** to HTTP/JSON:
```python
elif component_type == 'sources':
    component_data = {
        "sources": [
            {
                "title": source.title,
                "url": source.url
            }
            for source in grpc_chunk.component.sources.sources
        ]
    }
```

## Data Flow

```
1. Agent calls perform_web_search("Paris capital")
   ↓
2. WebSearchTool.web_search()
   - Calls LinkUp API
   - Gets answer + sources
   - Returns: {"text": "Paris is...\n\nSources:\n🔗 https://...", "sources": [{title, url}, ...]}
   ↓
3. SearchToolkit.perform_web_search()
   - Passes through dict
   - Returns dict to Google ADK
   ↓
4. Google ADK stores dict in function_response.response
   ↓
5. Agent (LLM) sees the dict and continues processing
   ↓
6. StreamingProcessor detects function_response
   - If func_name == "perform_web_search":
   - Extracts sources from response_data['sources']
   - Streams as sources component
   ↓
7. gRPC Servicer serializes to protobuf
   ↓
8. Frontend receives sources component
```

## Example Response

**Function returns to agent:**
```json
{
  "text": "Paris is the capital and most populous city of France.\n\nSources:\n🔗 https://en.wikipedia.org/wiki/Paris\n🔗 https://www.britannica.com/place/Paris",
  "sources": [
    {
      "title": "Wikipedia.org",
      "url": "https://en.wikipedia.org/wiki/Paris"
    },
    {
      "title": "Britannica.com",
      "url": "https://www.britannica.com/place/Paris"
    }
  ]
}
```

**Streamed as component:**
```json
{
  "action": "add",
  "component": {
    "id": "src_12345",
    "type": "sources",
    "data": {
      "sources": [
        {
          "title": "Wikipedia.org",
          "url": "https://en.wikipedia.org/wiki/Paris"
        },
        {
          "title": "Britannica.com",
          "url": "https://www.britannica.com/place/Paris"
        }
      ]
    }
  },
  "metadata": {
    "message_id": "msg_123",
    "agent_id": "manager"
  }
}
```

## Benefits

✅ **Agent behavior unchanged**: Agent still sees the full response (text + sources)
✅ **Sources extracted automatically**: No manual parsing needed
✅ **Clean separation**: Text for conversation, structured data for UI
✅ **Real-time streaming**: Sources arrive as soon as web search completes
✅ **Easy to extend**: Can add more fields (relevance, timestamp, etc.)
✅ **Type-safe**: Proto schema ensures data structure consistency

## Frontend Usage

The frontend can now:
1. Render agent's text response normally
2. Display sources in a dedicated "Sources" section
3. Create clickable links for each source
4. Show source titles for better UX
5. Track which searches provided which sources

## Testing

To test:
1. Start gRPC server: `python main.py`
2. Send request with web search enabled
3. Check console for logs:
   - `🔗 [WEB SEARCH] Sent N sources to client`
   - `🔗 [gRPC] Sending SOURCES component to client`
4. Verify frontend receives sources component

## Notes

- Sources are extracted from LinkUp API's response
- Domain names are automatically parsed for titles
- Each source has title and URL
- Sources are sent once per web search function call
- Multiple web searches in same conversation will send multiple sources components
