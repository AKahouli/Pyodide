# Adding New AI Message Components

This guide explains how to add new component types to the AI message system. Components are the building blocks of AI responses (text, code, reasoning, sources, etc.).

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Component Flow                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌───────────┐ │
│  │  Proto File  │───▶│   Backend    │───▶│   Frontend   │───▶│    UI     │ │
│  │  (Contract)  │    │  (Process)   │    │  (Render)    │    │ Component │ │
│  └──────────────┘    └──────────────┘    └──────────────┘    └───────────┘ │
│                                                                             │
│  chatbot.proto       stream.service.ts   ai-message-content.tsx   *.tsx    │
│                      message.interface   (types + renderer)                 │
│                      message.schema                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Files to Modify

| File | Purpose |
|------|---------|
| `back/src/modules/conversation/proto/chatbot.proto` | Define the component structure (contract with AI service) |
| `back/src/modules/conversation/interfaces/message.interface.ts` | TypeScript type for component types |
| `back/src/modules/conversation/schemas/message.schema.ts` | MongoDB schema validation |
| `back/src/modules/conversation/services/stream.service.ts` | Process incoming gRPC chunks |
| `front/src/modules/conversation/types.ts` | Frontend MessageComponent type |
| `front/src/modules/conversation/utils.ts` | Map backend components to frontend parts |
| `front/src/components/ai-elements/ai-message-content.tsx` | Frontend part types and renderer |
| `back/mock-grpc-server.js` | Mock server for testing |

---

## Step-by-Step Guide

### Step 1: Define the Proto Message

**File:** `back/src/modules/conversation/proto/chatbot.proto`

Add your component message definition and include it in the `Component` oneof:

```protobuf
// Define the component structure
message MyNewComponent {
    string title = 1;           // Required fields
    repeated string items = 2;  // Optional: arrays
    string status = 3;          // Optional: status field
}

// Add to Component oneof (use next available number)
message Component {
    string id = 1;
    oneof data {
        TextComponent text = 2;
        CodeComponent code = 3;
        // ... existing components ...
        MyNewComponent myNew = 12;  // <-- Add here with next number
    }
}
```

### Step 2: Add to Backend Interface

**File:** `back/src/modules/conversation/interfaces/message.interface.ts`

Add your component type to the `ComponentType` union:

```typescript
export type ComponentType =
  | 'text'
  | 'code'
  | 'reasoning'
  | 'plan'
  | 'queue'
  | 'checkpoint'
  | 'chart'
  | 'task'
  | 'error'
  | 'sources'
  | 'myNew';  // <-- Add here
```

### Step 3: Update MongoDB Schema

**File:** `back/src/modules/conversation/schemas/message.schema.ts`

Add your type to **both** enum arrays:

```typescript
// Line ~7: MessageComponentSchema class
@Prop({ type: String, required: true, enum: [
  'text', 'code', 'reasoning', 'plan', 'queue',
  'checkpoint', 'chart', 'task', 'error', 'sources',
  'myNew'  // <-- Add here
] })
type!: string;

// Line ~30: components prop
@Prop({ type: [{ type: { type: String, enum: [
  'text', 'code', 'reasoning', 'plan', 'queue',
  'checkpoint', 'chart', 'task', 'error', 'sources',
  'myNew'  // <-- Add here
] }, data: Object }], default: undefined })
components?: MessageComponentSchema[];
```

### Step 4: Update Stream Service

**File:** `back/src/modules/conversation/services/stream.service.ts`

#### 4a. Add type detection in `getComponentType()`:

```typescript
private getComponentType(comp: any): ComponentType {
  if (comp.text) return 'text';
  if (comp.code) return 'code';
  // ... existing checks ...
  if (comp.myNew) return 'myNew';  // <-- Add here
  return 'text';
}
```

#### 4b. Add data extraction in `extractComponentData()`:

```typescript
private extractComponentData(comp: any): { type: ComponentType; data: Record<string, unknown> } {
  const type = this.getComponentType(comp);

  switch (type) {
    // ... existing cases ...

    case 'myNew':
      return {
        type,
        data: {
          title: comp.myNew?.title || '',
          items: comp.myNew?.items || [],
          status: comp.myNew?.status || 'pending',
        },
      };

    default:
      return { type: 'text', data: { content: '' } };
  }
}
```

#### 4c. Add merge behavior in `mergeComponentData()`:

Choose based on your component's streaming behavior:

```typescript
private mergeComponentData(
  type: ComponentType,
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  switch (type) {
    // STREAMING: Content appends over multiple chunks
    case 'text':
    case 'reasoning': {
      const existingContent = (existing.content as string) || '';
      const newContent = (incoming.content as string) || '';
      return { ...existing, content: existingContent + newContent };
    }

    // NON-STREAMING: Arrives complete in one chunk (replace entirely)
    case 'queue':
    case 'plan':
    case 'sources':
    case 'myNew':  // <-- Add here if non-streaming
      return { ...incoming };

    default:
      return { ...existing, ...incoming };
  }
}
```

### Step 5: Update Frontend MessageComponent Type

**File:** `front/src/modules/conversation/types.ts`

Add your type to the `MessageComponent.type` union:

```typescript
export interface MessageComponent {
  type: 'text' | 'code' | 'reasoning' | 'plan' | 'queue' | 'checkpoint' | 'chart' | 'task' | 'error' | 'sources' | 'myNew';  // <-- Add here
  data: Record<string, unknown>;
}
```

### Step 6: Update Component Mapper

**File:** `front/src/modules/conversation/utils.ts`

Add a case in `mapComponentsToContentParts()` to map backend data to frontend part:

```typescript
export function mapComponentsToContentParts(components: MessageComponent[]): MessageContentPart[] {
  return components.map((comp): MessageContentPart => {
    switch (comp.type) {
      // ... existing cases ...

      case 'myNew':
        return {
          type: 'myNew',
          title: (comp.data.title as string) || '',
          items: (comp.data.items as string[]) || [],
          status: (comp.data.status as 'pending' | 'in_progress' | 'completed') || undefined,
        };

      default:
        return { type: 'text', content: (comp.data.content as string) || '' };
    }
  });
}
```

### Step 7: Add Frontend Part Types and Renderer

**File:** `front/src/components/ai-elements/ai-message-content.tsx`

#### 7a. Import UI components (if using existing ai-elements):

```typescript
import {
    MyNew,
    MyNewTrigger,
    MyNewContent,
    // ... other imports
} from "./my-new";
```

#### 7b. Add TypeScript interfaces:

```typescript
export interface MyNewItemData {
    text: string;
}

export interface MyNewPart {
    type: "myNew";
    title: string;
    items: string[];
    status?: "pending" | "in_progress" | "completed";
}
```

#### 7c. Add to MessageContentPart union:

```typescript
export type MessageContentPart =
    | TextPart
    | CodePart
    | ReasoningPart
    // ... existing parts ...
    | MyNewPart;  // <-- Add here
```

#### 7d. Add case in AIMessagePart switch:

```typescript
const AIMessagePart = ({ part, isStreaming = false }: AIMessagePartProps) => {
    switch (part.type) {
        // ... existing cases ...

        case "myNew":
            return (
                <MyNewPartRenderer
                    title={part.title}
                    items={part.items}
                    status={part.status}
                    isStreaming={isStreaming}
                />
            );

        default:
            return null;
    }
};
```

#### 7e. Create the renderer component:

```typescript
const MyNewPartRenderer = ({
    title,
    items,
    status,
    isStreaming = false,
}: {
    title: string;
    items: string[];
    status?: "pending" | "in_progress" | "completed";
    isStreaming?: boolean;
}) => (
    <div className="my-2 rounded-lg border p-4">
        <h3 className="font-semibold">{title}</h3>
        <ul className="mt-2 space-y-1">
            {items.map((item, index) => (
                <li key={index} className="text-sm text-muted-foreground">
                    {item}
                </li>
            ))}
        </ul>
    </div>
);
```

### Step 8: Update Mock gRPC Server

**File:** `back/mock-grpc-server.js`

#### 8a. Add chunk builder function:

```javascript
/**
 * Builds a single chunk for a myNew component.
 * MyNew arrives fully formed in one chunk.
 */
function buildMyNewChunk(componentId, title, items, options = {}) {
  const { delay = 100, status = 'completed', metadata } = options;
  return {
    delay,
    chunk: {
      action: 'add',
      component: {
        id: componentId,
        myNew: {
          title,
          items,
          status,
        },
      },
      metadata,
    },
  };
}
```

#### 8b. Add to runAgentTeam function:

```javascript
function runAgentTeam(call) {
  // ... existing code ...

  const myNewId = randomUUID();

  // Create the chunk
  const myNewChunk = buildMyNewChunk(
    myNewId,
    'My New Component Title',
    ['Item 1', 'Item 2', 'Item 3'],
    { status: 'completed', metadata }
  );

  // Add to allChunks array
  const allChunks = [
    // ... existing chunks ...
    myNewChunk,
  ];
}
```

---

## Component Types Reference

### Streaming Components
These components receive content incrementally over multiple chunks:

| Type | Behavior |
|------|----------|
| `text` | Content appends to form full markdown |
| `code` | Content appends; language/filename from first chunk |
| `reasoning` | Content appends; duration from final chunk |

### Non-Streaming Components
These components arrive complete in a single chunk:

| Type | Behavior |
|------|----------|
| `plan` | Full plan with steps; can receive updates |
| `queue` | Full queue with items |
| `task` | Full task list |
| `checkpoint` | Single label |
| `chart` | Full chart config (JSON strings) |
| `error` | Error title and content |
| `sources` | List of source URLs |

---

## Checklist

Use this checklist when adding a new component:

### Backend
- [ ] **Proto**: Added message definition in `chatbot.proto`
- [ ] **Proto**: Added to `Component` oneof
- [ ] **Interface**: Added to `ComponentType` union in `message.interface.ts`
- [ ] **Schema**: Added to enum in `MessageComponentSchema` class (line ~7)
- [ ] **Schema**: Added to enum in `components` prop (line ~30)
- [ ] **Stream**: Added detection in `getComponentType()`
- [ ] **Stream**: Added extraction in `extractComponentData()`
- [ ] **Stream**: Added merge behavior in `mergeComponentData()`

### Frontend
- [ ] **Types**: Added to `MessageComponent.type` union in `types.ts`
- [ ] **Utils**: Added case in `mapComponentsToContentParts()` in `utils.ts`
- [ ] **Content**: Added TypeScript interface(s) in `ai-message-content.tsx`
- [ ] **Content**: Added to `MessageContentPart` union
- [ ] **Content**: Added case in `AIMessagePart` switch
- [ ] **Content**: Created renderer component

### Testing
- [ ] **Mock**: Added chunk builder function
- [ ] **Mock**: Added to `allChunks` in `runAgentTeam()`

---

## Example: Sources Component

Here's a complete example of how the `sources` component was added:

<details>
<summary>Click to expand full example</summary>

### Proto Definition
```protobuf
message SourceItem {
    string title = 1;
    string url = 2;
}

message SourcesComponent {
    repeated SourceItem sources = 1;
}
```

### Backend Interface
```typescript
export type ComponentType =
  // ... |
  'sources';
```

### Stream Service Extract
```typescript
case 'sources':
  return {
    type,
    data: {
      sources: (comp.sources?.sources || []).map((s: any) => ({
        title: s.title || '',
        url: s.url || '',
      })),
    },
  };
```

### Frontend Types
```typescript
export interface SourceItemData {
    title: string;
    url: string;
}

export interface SourcesPart {
    type: "sources";
    sources: SourceItemData[];
}
```

### Frontend Renderer
```typescript
const SourcesPartRenderer = ({
    sources,
}: {
    sources: SourceItemData[];
}) => (
    <Sources className="my-2">
        <SourcesTrigger count={sources.length} />
        <SourcesContent>
            {sources.map((source, index) => (
                <Source key={index} href={source.url} title={source.title} />
            ))}
        </SourcesContent>
    </Sources>
);
```

</details>

---

## Troubleshooting

### "X is not a valid enum value for path `type`"
You forgot to add the type to the MongoDB schema enums in `message.schema.ts`. There are **two** places to update (lines ~7 and ~30).

### Component saved but not rendering
You likely forgot to update the frontend mapping. Check these files:
1. `front/src/modules/conversation/types.ts` - Add to `MessageComponent.type` union
2. `front/src/modules/conversation/utils.ts` - Add case in `mapComponentsToContentParts()`
3. `front/src/components/ai-elements/ai-message-content.tsx` - Add case in `AIMessagePart` switch

### Component not rendering (other causes)
1. Check if the case was added to the `AIMessagePart` switch
2. Verify the type string matches exactly (case-sensitive)
3. Check browser console for React errors

### Data not extracting correctly
1. Log the raw `comp` object in `extractComponentData()` to see the structure
2. Verify field names match the proto definition (uses snake_case from proto)

### Mock server not sending component
1. Verify the chunk was added to `allChunks` array
2. Check that `randomUUID()` was called for the component ID
3. Look at mock server console logs for errors
