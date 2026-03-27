# Stream Chunk Types - API Reference

This document describes all the different types of stream chunks that the gRPC/SSE API can send.

## StreamChunk Structure

Every chunk has these fields:

```protobuf
message StreamChunk {
    string agent_id = 1;         // Agent ID (e.g., "6964c7e915f75336d1b88f23")
    string agent_name = 2;       // Agent display name (e.g., "Search Agent")
    string agent_type = 3;       // Agent type (see Agent Types below)
    string chunk = 4;            // The actual content/data
    string message_id = 5;       // Message/session ID
    string message_type = 6;     // Message type (see Message Types below)
    string content_type = 7;     // Content type (see Content Types below)
    int32 chunk_order = 8;       // Sequential order number
    string chunk_id = 9;         // Unique chunk identifier (UUID)
}
```

---

## Content Types

The `content_type` field indicates what kind of content is in the chunk:

### 1. **`"chunk"`** - Regular Text Content
**Description:** Normal streaming text/response from agents
**Typical `chunk` value:** Text content being streamed
**Agent types:** Any agent (manager, agent, html)
**Example:**
```json
{
  "content_type": "chunk",
  "chunk": "Based on the documents...",
  "agent_type": "agent",
  "agent_name": "Search Agent"
}
```

### 2. **`"description"`** - Task Description
**Description:** Agent describing what task it's about to perform
**Typical `chunk` value:** Description of the task
**Agent types:** Usually "agent"
**Example:**
```json
{
  "content_type": "description",
  "chunk": "Searching internal documents for sales data",
  "agent_name": "Search Agent"
}
```

### 3. **`"source"`** - Source Citations
**Description:** Citations and source references from document searches
**Typical `chunk` value:** JSON array of source objects
**Agent types:** Usually "agent"
**Example:**
```json
{
  "content_type": "source",
  "chunk": "[{\"doc_id\": \"123\", \"filename\": \"report.pdf\", \"page\": 5}]",
  "agent_name": "Search Agent"
}
```

### 4. **`"final_response"`** - End of Stream
**Description:** Indicates the stream is complete
**Typical `chunk` value:** `"end_of_message"`
**Agent types:** Usually "manager"
**Special:** This is always the last chunk - client should stop listening
**Example:**
```json
{
  "content_type": "final_response",
  "chunk": "end_of_message",
  "agent_type": "manager",
  "agent_name": "Manager Agent"
}
```

### 5. **`"ui"`** - UI/Visualization Content
**Description:** Interactive UI elements, charts, forms, or visualizations
**Typical `chunk` value:** JSON object with UI configuration
**Agent types:** Usually "manager"
**Used for:** DataViz charts, FormViz forms, interactive elements
**Example:**
```json
{
  "content_type": "ui",
  "chunk": "{\"type\": \"chart\", \"data\": {...}, \"config\": {...}}",
  "agent_type": "manager"
}
```

### 6. **`"File"`** - File Upload/Processing
**Description:** Information about uploaded or processed files
**Typical `chunk` value:** JSON with file metadata
**Agent types:** "agent"
**Example:**
```json
{
  "content_type": "File",
  "chunk": "{\"filename\": \"data.csv\", \"size\": 1024, \"status\": \"processed\"}",
  "agent_name": "File Processor"
}
```

### 7. **`"error"`** - Error Messages
**Description:** Error notifications from agents
**Typical `chunk` value:** Error message string
**Agent types:** Any
**Example:**
```json
{
  "content_type": "error",
  "chunk": "Error: Document not found in workspace",
  "agent_name": "Search Agent"
}
```

### 8. **`"suggestions"`** - Agent Suggestions (Auto Mode)
**Description:** List of suggested agents for the user query
**Typical `chunk` value:** JSON array of agent suggestion objects
**Agent types:** "suggestions"
**Message type:** `"no-streaming"` (sent all at once)
**Used in:** Auto agent mode when generating agent suggestions
**Example:**
```json
{
  "content_type": "suggestions",
  "chunk": "[{\"name\": \"Search Agent\", \"description\": \"...\", \"tools\": [...]}]",
  "agent_type": "suggestions",
  "agent_name": "system",
  "message_type": "no-streaming"
}
```

---

## Message Types

The `message_type` field indicates how the content is delivered:

### **`"streaming"`** (Default)
- Content is sent incrementally in chunks
- Used for most agent responses
- Client should append chunks as they arrive

### **`"no-streaming"`**
- Content is sent in a single complete chunk
- Used for agent suggestions and complete responses
- No need to buffer/append

### **`"error"`**
- Error message delivery
- Indicates something went wrong
- May not be followed by final_response

---

## Agent Types

The `agent_type` field indicates which type of agent sent the chunk:

### **`"manager"`**
- The manager/orchestrator agent
- Coordinates other agents
- Usually sends final_response

### **`"agent"`**
- Regular specialized agent (search, analysis, etc.)
- Performs specific tasks
- Most common type

### **`"html"`**
- HTML visualization agent
- Generates HTML diagrams and visualizations
- Deprecated in favor of UI chunks

### **`"suggestions"`**
- System agent for agent suggestions
- Only used in auto mode
- Sends list of suggested agents

---

## Special Search/Tool Chunks

When agents use tools, they send special formatted chunks:

### Internal Document Search
```json
{
  "content_type": "chunk",
  "chunk": "🔎 recherche interne : sales report Q4\n\n",
  "agent_type": "agent"
}
```

### Web Search
```json
{
  "content_type": "chunk",
  "chunk": "🌐 web search : latest market trends\n\n",
  "agent_type": "agent"
}
```

### Calculation
```json
{
  "content_type": "chunk",
  "chunk": "Calculating: (123 + 456) * 2",
  "agent_type": "agent"
}
```

### UI Generation (DataViz/FormViz)
```json
{
  "content_type": "ui",
  "chunk": "generating ui",
  "agent_type": "manager"
}
```
Followed by:
```json
{
  "content_type": "ui",
  "chunk": "{\"html\": \"<div>...</div>\", \"css\": \"...\", \"js\": \"...\"}",
  "agent_type": "manager"
}
```

---

## Typical Stream Flow

### Manual Mode (with provided agents):
1. `chunk` with `content_type="description"` - Agent introduces its task
2. Multiple `chunk` with `content_type="chunk"` - Agent's response text
3. `chunk` with `content_type="source"` - Citations (if search was used)
4. `chunk` with `content_type="ui"` - Interactive elements (if applicable)
5. `chunk` with `content_type="final_response"` - Stream end marker

### Auto Mode (agent suggestions):
1. `chunk` with `content_type="suggestions"` - List of suggested agents
2. (User selects agents)
3. Same flow as manual mode

### Error Flow:
1. `chunk` with `content_type="error"` - Error message
2. `chunk` with `content_type="final_response"` - Stream end (may be skipped)

---

## Client Implementation Example

```python
for chunk in stub.RunAgentTeam(request):
    if chunk.content_type == "chunk":
        # Regular text - append to display
        print(chunk.chunk, end="", flush=True)

    elif chunk.content_type == "description":
        # Task description - show in UI
        print(f"\n[Task] {chunk.agent_name}: {chunk.chunk}\n")

    elif chunk.content_type == "source":
        # Citations - parse JSON and display
        sources = json.loads(chunk.chunk)
        print(f"\nSources: {sources}\n")

    elif chunk.content_type == "ui":
        # UI element - render in browser
        ui_data = json.loads(chunk.chunk)
        render_visualization(ui_data)

    elif chunk.content_type == "error":
        # Error - show to user
        print(f"\n❌ Error: {chunk.chunk}\n")

    elif chunk.content_type == "suggestions":
        # Agent suggestions - show for selection
        suggestions = json.loads(chunk.chunk)
        display_agent_suggestions(suggestions)

    elif chunk.content_type == "final_response":
        # End of stream - close connection
        print("\n✅ Done!")
        break
```

---

## Notes

1. **Always check for `final_response`** - It signals the end of the stream
2. **Parse JSON chunks** - `source`, `ui`, `File`, and `suggestions` contain JSON
3. **Handle errors gracefully** - `error` chunks may appear at any time
4. **Buffer text chunks** - Accumulate `chunk` content_type for display
5. **Use chunk_order** - For reordering if chunks arrive out of sequence
6. **Track agent_name** - To display which agent is responding
