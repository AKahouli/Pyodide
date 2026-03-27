# Message Data Structure Documentation

The chat application supports a rich, structured message format allowing the AI to return varied content types beyond simple text.

## Core Type: `MessageContentPart`

The `content` field of a `ChatMessage` from the assistant can be an array of `MessageContentPart` objects. This is a discriminated union type based on the `type` property.

### Supported Types

1.  **Text (`text`)**
    - Standard text content.
    - **Fields**:
      - `type: "text"`
      - `content`: string (Markdown supported)

2.  **Code (`code`)**
    - Enhanced code block with syntax highlighting and file metadata.
    - **Fields**:
      - `type: "code"`
      - `content`: string (The code itself)
      - `language`: string (e.g., "typescript", "python")
      - `filename?`: string (Optional filename for header)

3.  **Reasoning (`reasoning`)**
    - Internal thought process, displayed in a collapsible "Thinking..." block.
    - **Fields**:
      - `type: "reasoning"`
      - `content`: string
      - `duration?`: number (Time in seconds)

4.  **Queue (`queue`)**
    - A list of tasks showing the execution plan status.
    - **Fields**:
      _ `type: "queue"`
      _ `title?`: string
      _ `items`: Array of `QueueItemData`
      _ `id`: string
      _ `title`: string
      _ `status`: "pending" | "active" | "completed"
      Note the Queue streaming of the array is one element by one element so appending queue component is appending the items array(the content of the item comes full)

5.  **Plan (`plan`)**
    - A detailed card for a specific step or action.
    - **Fields**:
      - `type: "plan"`
      - `title`: string
      - `description`: string
      - `steps?`: string[] (Sub-steps for this plan item)
      - `status?`: "active" | "completed"

      Note the plan streaming of the steps is one element by one element so appending plan component is appending the steps array(the content of the steps comes full)

6.  **Checkpoint (`checkpoint`)**
    - A visual separator marking a milestone or phase.
    - **Fields**:
      - `type: "checkpoint"`
      - `label`: string

      Note: the checkpôint arrives full in one chunk

7.  **Chart (`chart`)**
    - Data visualization using shadcn/recharts.
    - **Fields**:
      - `type: "chart"`
      - `title?`: string
      - `data`: Record<string, any>[] (Array of data objects)
      - `config`: ChartConfig (Color/Label configuration)
      - `xAxisKey`: string (Key in data object for X-axis)
      - `series`: Array of objects:
        - `dataKey`: string (Key for bar value)
        - `color?`: string
        - `label?`: string

## Example Structure

```json
[
  {
    "type": "reasoning",
    "content": "User wants a chart. I should fetch data first...",
    "duration": 2
  },
  {
    "type": "queue",
    "title": "Execution Plan",
    "items": [
      { "id": "1", "title": "Fetch Data", "status": "completed" },
      { "id": "2", "title": "Render Chart", "status": "active" }
    ]
  },
  {
    "type": "text",
    "content": "Here is the stock performance you requested:"
  },
  {
    "type": "chart",
    "title": "Stock Price",
    "data": [{ "year": "2024", "price": 100 }],
    "config": { "price": { "label": "Price", "color": "blue" } },
    "xAxisKey": "year",
    "series": [{ "dataKey": "price" }]
  }
]
```
