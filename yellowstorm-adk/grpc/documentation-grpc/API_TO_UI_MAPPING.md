# API Content Types → UI Message Components Mapping

This document maps the gRPC API's `content_type` values to the ai-sdk.dev `MessageContentPart` types for frontend rendering.

---

## Direct Mappings

| API `content_type` | UI Component Type | Notes |
|-------------------|-------------------|-------|
| **`"chunk"`** | **`"text"`** | Regular streaming text → Standard text content (Markdown supported) |
| **`"description"`** | **`"plan"`** | Task description → Plan card showing what agent will do |
| **`"source"`** | **`"text"`** (formatted) | Citations → Formatted text with source references |
| **`"ui"`** (charts) | **`"chart"`** | DataViz JSON → Chart component |
| **`"ui"`** (forms) | Custom component | FormViz → Custom form renderer |
| **`"File"`** | **`"text"`** or custom | File metadata → Formatted file attachment |
| **`"error"`** | **`"text"`** (styled) | Error message → Text with error styling |
| **`"final_response"`** | *(not rendered)* | Stream end signal → No UI component |

---

## Suggested Enhanced Mappings

These mappings add richer UI experiences by interpreting agent behavior:

### 1. **Search/Tool Actions** → `"reasoning"`
When agents perform searches or calculations, show them as thinking blocks.

**API Chunks:**
```json
{
  "content_type": "chunk",
  "chunk": "🔎 recherche interne : sales report\n\n"
}
```

**Transform to UI:**
```json
{
  "type": "reasoning",
  "content": "Searching internal documents for: sales report"
}
```

---

### 2. **Agent Workflow** → `"queue"`
Track multiple agents and their execution status.

**API Context:** Multiple agents executing tasks

**Transform to UI:**
```json
{
  "type": "queue",
  "title": "Agent Workflow",
  "items": [
    {"id": "1", "title": "Search Agent: Finding documents", "status": "completed"},
    {"id": "2", "title": "Analysis Agent: Processing results", "status": "active"},
    {"id": "3", "title": "Report Agent: Generating summary", "status": "pending"}
  ]
}
```

---

### 3. **Task Description** → `"plan"`
Show what the agent is planning to do.

**API Chunk:**
```json
{
  "content_type": "description",
  "chunk": "I will search for sales data in Q4 2024 reports"
}
```

**Transform to UI:**
```json
{
  "type": "plan",
  "title": "Search Agent",
  "description": "I will search for sales data in Q4 2024 reports",
  "status": "active"
}
```

---

### 4. **Agent Delegation** → `"checkpoint"`
Mark when manager delegates to a new agent.

**API Context:** Manager calls delegate function

**Transform to UI:**
```json
{
  "type": "checkpoint",
  "label": "Delegated to Search Agent"
}
```

---

### 5. **Regular Text** → `"text"`
Standard streaming response.

**API Chunk:**
```json
{
  "content_type": "chunk",
  "chunk": "Based on the documents, the Q4 sales were..."
}
```

**Transform to UI:**
```json
{
  "type": "text",
  "content": "Based on the documents, the Q4 sales were..."
}
```

---

### 6. **Code in Response** → `"code"`
If agent returns code blocks (extracted from markdown).

**API Chunk:**
```json
{
  "content_type": "chunk",
  "chunk": "```python\ndef calculate():\n    return 42\n```"
}
```

**Transform to UI:**
```json
{
  "type": "code",
  "content": "def calculate():\n    return 42",
  "language": "python"
}
```

---

### 7. **DataViz Charts** → `"chart"`
Transform UI chunks with chart data.

**API Chunk:**
```json
{
  "content_type": "ui",
  "chunk": "{\"type\": \"chart\", \"data\": [{\"month\": \"Jan\", \"sales\": 100}], \"config\": {...}}"
}
```

**Transform to UI:**
```json
{
  "type": "chart",
  "title": "Sales Report",
  "data": [{"month": "Jan", "sales": 100}],
  "config": {"sales": {"label": "Sales", "color": "blue"}},
  "xAxisKey": "month",
  "series": [{"dataKey": "sales"}]
}
```

---

### 8. **Sources/Citations** → `"text"` with formatting
Display citations at the end of responses.

**API Chunk:**
```json
{
  "content_type": "source",
  "chunk": "[{\"doc_id\": \"123\", \"filename\": \"report.pdf\", \"page\": 5}]"
}
```

**Transform to UI:**
```json
{
  "type": "text",
  "content": "**Sources:**\n- report.pdf (page 5)"
}
```

---

### 9. **Errors** → `"text"` with error styling
Show errors prominently.

**API Chunk:**
```json
{
  "content_type": "error",
  "chunk": "Error: Document not found"
}
```

**Transform to UI:**
```json
{
  "type": "text",
  "content": "⚠️ **Error:** Document not found"
}
```
*(Apply red/error styling in your UI)*

---

## Complete Example: Multi-Agent Response

### API Stream Sequence:
```json
1. {"content_type": "description", "chunk": "Searching for sales data", "agent_name": "Search Agent"}
2. {"content_type": "chunk", "chunk": "🔎 recherche interne : Q4 sales\n\n"}
3. {"content_type": "chunk", "chunk": "I found 3 relevant documents..."}
4. {"content_type": "source", "chunk": "[{\"filename\": \"Q4_Report.pdf\", \"page\": 2}]"}
5. {"content_type": "ui", "chunk": "{\"type\": \"chart\", ...}"}
6. {"content_type": "final_response", "chunk": "end_of_message"}
```

### Transformed UI Message Parts:
```json
[
  {
    "type": "plan",
    "title": "Search Agent",
    "description": "Searching for sales data",
    "status": "active"
  },
  {
    "type": "reasoning",
    "content": "Searching internal documents for: Q4 sales"
  },
  {
    "type": "text",
    "content": "I found 3 relevant documents..."
  },
  {
    "type": "text",
    "content": "**Sources:**\n- Q4_Report.pdf (page 2)"
  },
  {
    "type": "chart",
    "title": "Q4 Sales Data",
    "data": [...],
    "config": {...},
    "xAxisKey": "month",
    "series": [{"dataKey": "sales"}]
  }
]
```
*(Note: `final_response` is not rendered)*

---

## Implementation Strategy

### Client-Side Transformation Function

```typescript
function transformAPIChunkToUIMessage(chunk: StreamChunk): MessageContentPart | null {
  switch (chunk.content_type) {
    case "chunk":
      // Check if it's a search/tool action
      if (chunk.chunk.includes("🔎") || chunk.chunk.includes("🌐")) {
        return {
          type: "reasoning",
          content: extractSearchQuery(chunk.chunk)
        };
      }

      // Check for code blocks
      if (chunk.chunk.includes("```")) {
        return extractCodeBlock(chunk.chunk);
      }

      // Regular text
      return {
        type: "text",
        content: chunk.chunk
      };

    case "description":
      return {
        type: "plan",
        title: chunk.agent_name,
        description: chunk.chunk,
        status: "active"
      };

    case "source":
      const sources = JSON.parse(chunk.chunk);
      return {
        type: "text",
        content: formatSources(sources)
      };

    case "ui":
      const uiData = JSON.parse(chunk.chunk);
      if (uiData.type === "chart") {
        return {
          type: "chart",
          ...transformChartData(uiData)
        };
      }
      // Handle other UI types (forms, etc.)
      return null;

    case "error":
      return {
        type: "text",
        content: `⚠️ **Error:** ${chunk.chunk}`
      };

    case "final_response":
      // Don't render, just signal end
      return null;

    default:
      return {
        type: "text",
        content: chunk.chunk
      };
  }
}
```

---

## Recommended UI Flow

1. **Initialize message parts array:** `messageParts: MessageContentPart[] = []`

2. **For each chunk received:**
   - Transform using `transformAPIChunkToUIMessage(chunk)`
   - If not null, append to `messageParts`
   - Update UI to render `messageParts`

3. **On `final_response`:**
   - Stop listening to stream
   - Mark message as complete

4. **Special handling:**
   - **Queue component:** Update separately by tracking agent statuses
   - **Checkpoints:** Insert when manager delegates (detect delegate function calls)
   - **Reasoning duration:** Track time between description and first text chunk

---

## Summary Table

| API Type | UI Type | When to Use |
|----------|---------|-------------|
| `chunk` (text) | `text` | Normal response text |
| `chunk` (search) | `reasoning` | Agent searching/thinking |
| `chunk` (code) | `code` | Code blocks in response |
| `description` | `plan` | Agent task description |
| `source` | `text` (formatted) | Citations/references |
| `ui` (chart) | `chart` | Data visualizations |
| `ui` (form) | Custom | Interactive forms |
| `error` | `text` (styled) | Error messages |
| `File` | `text` or custom | File attachments |
| Agent workflow | `queue` | Multi-agent orchestration |
| Agent delegation | `checkpoint` | Phase transitions |

---

## Notes

- **Markdown support:** The `text` type supports Markdown, so you can format citations, bold text, etc.
- **Custom components:** For FormViz and complex UI, you may need custom renderers beyond the standard types
- **Progressive enhancement:** Start with basic `text` mapping, then add richer types (`plan`, `queue`, etc.) progressively
- **Streaming UX:** Update the UI incrementally as chunks arrive for real-time feedback