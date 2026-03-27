# Component Types Guide

## Overview

The new stream format supports typed components using protobuf `oneof`. Each component type has specific fields tailored to its purpose.

---

## Component Structure

```protobuf
message Component {
    string id = 1;               // Unique identifier
    oneof data {
        TextComponent text = 2;
        CodeComponent code = 3;
        ReasoningComponent reasoning = 4;
        PlanComponent plan = 5;
        QueueComponent queue = 6;
        CheckpointComponent checkpoint = 7;
        ChartComponent chart = 8;
    }
}
```

---

## 1. Text Component

**Usage:** Regular text/markdown content from agents

**Fields:**
- `content` (string): Text or markdown content

**Python Example:**
```python
formatter.format_component_event(
    agent_id="agent-123",
    component_type="text",
    component_data={"content": "Based on the documents, I found..."},
    message_id="session-id"
)
```

**Protobuf Output:**
```protobuf
StreamChunk {
    action: "add"
    component: {
        id: "uuid-123"
        text: {
            content: "Based on the documents, I found..."
        }
    }
    metadata: { ... }
}
```

**Frontend (TypeScript):**
```typescript
if (chunk.component.text) {
    const content = chunk.component.text.content;
    renderMarkdown(content);
}
```

---

## 2. Plan Component

**Usage:** Task descriptions and agent plans

**Fields:**
- `title` (string): Plan title
- `description` (string): Plan description
- `steps` (string[]): Optional list of sub-steps
- `status` (string): "active" or "completed"

**Python Example:**
```python
formatter.format_component_event(
    agent_id="agent-123",
    component_type="plan",
    component_data={
        "title": "Search Agent",
        "description": "I will search for Q4 sales data in the documents",
        "steps": ["Search internal documents", "Filter by date", "Extract metrics"],
        "status": "active"
    },
    message_id="session-id"
)
```

**Protobuf Output:**
```protobuf
component: {
    id: "uuid-123"
    plan: {
        title: "Search Agent"
        description: "I will search for Q4 sales data in the documents"
        steps: ["Search internal documents", "Filter by date", "Extract metrics"]
        status: "active"
    }
}
```

**Frontend (TypeScript):**
```typescript
if (chunk.component.plan) {
    const plan = chunk.component.plan;
    renderPlanCard({
        title: plan.title,
        description: plan.description,
        steps: plan.steps,
        status: plan.status
    });
}
```

---

## 3. Code Component

**Usage:** Code blocks with syntax highlighting

**Fields:**
- `content` (string): The code itself
- `language` (string): Programming language (e.g., "python", "typescript")
- `filename` (string): Optional filename

**Python Example:**
```python
formatter.format_component_event(
    agent_id="agent-123",
    component_type="code",
    component_data={
        "content": "def calculate(x):\n    return x * 2",
        "language": "python",
        "filename": "calculator.py"
    },
    message_id="session-id"
)
```

**Protobuf Output:**
```protobuf
component: {
    id: "uuid-123"
    code: {
        content: "def calculate(x):\n    return x * 2"
        language: "python"
        filename: "calculator.py"
    }
}
```

**Frontend (TypeScript):**
```typescript
if (chunk.component.code) {
    const code = chunk.component.code;
    renderCodeBlock({
        code: code.content,
        language: code.language,
        filename: code.filename
    });
}
```

---

## 4. Reasoning Component

**Usage:** Agent thinking process / internal reasoning

**Fields:**
- `content` (string): The thought process
- `duration` (int32): Optional time in seconds

**Python Example:**
```python
formatter.format_component_event(
    agent_id="agent-123",
    component_type="reasoning",
    component_data={
        "content": "Searching internal documents for Q4 sales data...",
        "duration": 2
    },
    message_id="session-id"
)
```

**Protobuf Output:**
```protobuf
component: {
    id: "uuid-123"
    reasoning: {
        content: "Searching internal documents for Q4 sales data..."
        duration: 2
    }
}
```

**Frontend (TypeScript):**
```typescript
if (chunk.component.reasoning) {
    const reasoning = chunk.component.reasoning;
    renderThinkingBlock({
        content: reasoning.content,
        duration: reasoning.duration
    });
}
```

---

## 5. Queue Component

**Usage:** Multi-agent workflow tracking

**Fields:**
- `title` (string): Queue title
- `items` (QueueItem[]): List of tasks
  - `id` (string): Item ID
  - `title` (string): Item title
  - `status` (string): "pending", "active", or "completed"

**Python Example:**
```python
formatter.format_component_event(
    agent_id="manager-123",
    component_type="queue",
    component_data={
        "title": "Agent Workflow",
        "items": [
            {"id": "1", "title": "Search Agent: Finding documents", "status": "completed"},
            {"id": "2", "title": "Analysis Agent: Processing results", "status": "active"},
            {"id": "3", "title": "Report Agent: Generating summary", "status": "pending"}
        ]
    },
    message_id="session-id"
)
```

**Protobuf Output:**
```protobuf
component: {
    id: "uuid-123"
    queue: {
        title: "Agent Workflow"
        items: [
            { id: "1", title: "Search Agent: Finding documents", status: "completed" },
            { id: "2", title: "Analysis Agent: Processing results", status: "active" },
            { id: "3", title: "Report Agent: Generating summary", status: "pending" }
        ]
    }
}
```

**Frontend (TypeScript):**
```typescript
if (chunk.component.queue) {
    const queue = chunk.component.queue;
    renderQueueList({
        title: queue.title,
        items: queue.items.map(item => ({
            id: item.id,
            title: item.title,
            status: item.status // "pending" | "active" | "completed"
        }))
    });
}
```

---

## 6. Checkpoint Component

**Usage:** Phase transitions / milestones

**Fields:**
- `label` (string): Checkpoint label

**Python Example:**
```python
formatter.format_component_event(
    agent_id="manager-123",
    component_type="checkpoint",
    component_data={
        "label": "Delegated to Search Agent"
    },
    message_id="session-id"
)
```

**Protobuf Output:**
```protobuf
component: {
    id: "uuid-123"
    checkpoint: {
        label: "Delegated to Search Agent"
    }
}
```

**Frontend (TypeScript):**
```typescript
if (chunk.component.checkpoint) {
    const checkpoint = chunk.component.checkpoint;
    renderCheckpoint({
        label: checkpoint.label
    });
}
```

---

## 7. Chart Component

**Usage:** Data visualizations

**Fields:**
- `title` (string): Chart title
- `data` (string): JSON string of data array
- `config` (string): JSON string of chart configuration
- `xAxisKey` (string): Key for X-axis
- `series` (string): JSON string of series array

**Python Example:**
```python
import json

formatter.format_component_event(
    agent_id="agent-123",
    component_type="chart",
    component_data={
        "title": "Q4 Sales Performance",
        "data": json.dumps([
            {"month": "Oct", "sales": 120},
            {"month": "Nov", "sales": 150},
            {"month": "Dec", "sales": 180}
        ]),
        "config": json.dumps({
            "sales": {"label": "Sales", "color": "blue"}
        }),
        "xAxisKey": "month",
        "series": json.dumps([{"dataKey": "sales"}])
    },
    message_id="session-id"
)
```

**Protobuf Output:**
```protobuf
component: {
    id: "uuid-123"
    chart: {
        title: "Q4 Sales Performance"
        data: "[{\"month\":\"Oct\",\"sales\":120},...]"
        config: "{\"sales\":{\"label\":\"Sales\",\"color\":\"blue\"}}"
        xAxisKey: "month"
        series: "[{\"dataKey\":\"sales\"}]"
    }
}
```

**Frontend (TypeScript):**
```typescript
if (chunk.component.chart) {
    const chart = chunk.component.chart;
    renderChart({
        title: chart.title,
        data: JSON.parse(chart.data),
        config: JSON.parse(chart.config),
        xAxisKey: chart.xAxisKey,
        series: JSON.parse(chart.series)
    });
}
```

---

## Type Detection in Frontend

```typescript
function handleStreamChunk(chunk: StreamChunk) {
    const component = chunk.component;

    // Check which oneof field is set
    if (component.text) {
        renderTextComponent(component.id, component.text);
    } else if (component.plan) {
        renderPlanComponent(component.id, component.plan);
    } else if (component.code) {
        renderCodeComponent(component.id, component.code);
    } else if (component.reasoning) {
        renderReasoningComponent(component.id, component.reasoning);
    } else if (component.queue) {
        renderQueueComponent(component.id, component.queue);
    } else if (component.checkpoint) {
        renderCheckpointComponent(component.id, component.checkpoint);
    } else if (component.chart) {
        renderChartComponent(component.id, component.chart);
    }
}
```

---

## Example: Multi-Component Response

A typical agent response might send multiple components:

1. **Plan** - What the agent will do
```python
format_component_event(..., "plan", {
    "title": "Search Agent",
    "description": "Searching for sales data",
    "status": "active"
})
```

2. **Reasoning** - Search action
```python
format_component_event(..., "reasoning", {
    "content": "🔎 Searching internal documents for Q4 sales..."
})
```

3. **Text** - Results
```python
format_component_event(..., "text", {
    "content": "I found 3 relevant documents..."
})
```

4. **Chart** - Visualization
```python
format_component_event(..., "chart", {
    "title": "Sales Trend",
    "data": json.dumps([...]),
    ...
})
```

---

## Benefits of Typed Components

✅ **Type Safety** - Protobuf enforces correct structure
✅ **Clear Contract** - Frontend knows exact fields for each type
✅ **Efficient Encoding** - Only relevant fields are sent
✅ **Easy Validation** - Invalid data caught at protobuf level
✅ **IDE Support** - Autocomplete for component fields

---

## Migration from Old Format

Old format chunks with `content_type` are automatically converted:

| Old `content_type` | New Component Type | Data Mapping |
|--------------------|-------------------|--------------|
| `chunk` | `TextComponent` | `content: chunk` |
| `description` | `PlanComponent` | `description: chunk, status: "active"` |
| `ui` | `ChartComponent` | Parse JSON from chunk |
| `error` | `TextComponent` | `content: chunk` |

---

## Next Steps

1. Regenerate protobuf files: `./regenerate_proto.sh`
2. Update code to use `format_component_event()` with typed data
3. Implement frontend rendering for each component type