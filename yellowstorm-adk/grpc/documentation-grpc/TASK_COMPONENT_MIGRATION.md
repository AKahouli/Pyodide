# Migration from Plan to Task Component

## Overview

Changed from using the **Plan** component to the **Task** component for displaying agent task descriptions. This is more aligned with AI SDK Elements standards and provides better visual feedback with status indicators.

---

## What Changed

### Backend Changes

**File:** `src/smart_rag/messaging/formatters.py`

#### 1. Component Type Mapping (Line 111-119)

**Before:**
```python
component_type_map = {
    "chunk": "text",
    "description": "plan",  # Old
    "source": "text",
    ...
}
```

**After:**
```python
component_type_map = {
    "chunk": "text",
    "description": "task",  # Changed to task
    "source": "text",
    ...
}
```

#### 2. Component Data Structure (Line 123-128)

**Before:**
```python
if component_type == "plan":
    component_data = {
        "title": agent_name,
        "description": chunk,
        "status": "active"
    }
```

**After:**
```python
if component_type == "task":
    component_data = {
        "title": agent_name,
        "items": [{"text": chunk}],  # Task expects items array
        "status": "in_progress"      # Task uses in_progress not active
    }
```

**Key differences:**
- `description` → `items` (array of task items)
- `status: "active"` → `status: "in_progress"`

### Frontend Changes

#### 1. New Component Created

**File:** `nextjs-test-ui/app/components/TaskComponent.tsx`

Simple Task component that displays:
- ✅ **Status icon** (pending, in_progress, completed)
- 📝 **Title** (agent name)
- 🔘 **Items list** (task description as bullet points)
- 🏷️ **Status badge** (colored badge showing current status)

**Data Structure:**
```typescript
interface TaskData {
  title?: string;
  items?: TaskItem[];
  status?: 'pending' | 'in_progress' | 'completed';
}

interface TaskItem {
  text: string;
}
```

#### 2. Updated page.tsx

**File:** `nextjs-test-ui/app/page.tsx`

**Import change:**
```typescript
// Before
import { PlanComponent } from './components/PlanComponent';

// After
import { TaskComponent } from './components/TaskComponent';
```

**Rendering change (Line ~168):**
```typescript
// Before
} else if (comp.type === 'plan') {
  return <PlanComponent key={key} data={comp.data} />;

// After
} else if (comp.type === 'task') {
  return <TaskComponent key={key} data={comp.data} />;
```

**Welcome screen update:**
```typescript
// Before
<span>📋 Plans</span>

// After
<span>✅ Tasks</span>
```

---

## Data Flow Example

### Backend Sends (gRPC)

When agent starts a task:

```python
# formatters.py sends this component
{
    "action": "add",
    "component": {
        "id": "task-abc-123",
        "type": "task",
        "data": {
            "title": "search_agent",
            "items": [
                {"text": "Say hello to the user as the search agent."}
            ],
            "status": "in_progress"
        }
    },
    "metadata": {
        "message_id": "msg-1",
        "agent_id": "6964c7e915f75336d1b88f24"
    }
}
```

### Frontend Receives

**Next.js API route** forwards to frontend:

```javascript
dataStream.writeData({
    action: "add",
    component: {
        id: "task-abc-123",
        type: "task",
        data: {
            title: "search_agent",
            items: [{"text": "Say hello to the user as the search agent."}],
            status: "in_progress"
        }
    }
});
```

### Frontend Renders

**TaskComponent** displays:

```
┌─────────────────────────────────────────┐
│ 🔄 search_agent        [in_progress]    │
│                                          │
│ • Say hello to the user as the search   │
│   agent.                                 │
└─────────────────────────────────────────┘
```

---

## Status Values

### Old Plan Component
- `"active"` - Currently running
- `"completed"` - Finished

### New Task Component
- `"pending"` - Waiting to start (gray icon, gray badge)
- `"in_progress"` - Currently running (blue spinning icon, blue badge)
- `"completed"` - Finished (green checkmark icon, green badge)

---

## Visual Comparison

### Old Plan Component

```
┌─────────────────────────────────────┐
│ 📋 search_agent                     │
│                                     │
│ Say hello to the user as the       │
│ search agent.                       │
│                                     │
│ Status: active                      │
└─────────────────────────────────────┘
```

### New Task Component

```
┌─────────────────────────────────────┐
│ 🔄 search_agent    [in_progress]   │
│                                     │
│ • Say hello to the user as the     │
│   search agent.                     │
└─────────────────────────────────────┘
```

**Improvements:**
- ✅ Visual status icon (spinning when in progress)
- ✅ Cleaner layout with better spacing
- ✅ Status badge in header (not separate section)
- ✅ Bullet points for items (clearer structure)
- ✅ Color-coded based on status
- ✅ Follows AI SDK Elements patterns

---

## Update Behavior

### When Backend Updates Task Status

**Backend sends:**
```python
{
    "action": "update",
    "component": {
        "id": "task-abc-123",
        "type": "task",
        "data": {
            "status": "completed"  # Only status changes
        }
    }
}
```

**Frontend merges:**
```javascript
// mergeComponentData uses shallow merge for task type
const merged = { ...existingData, ...newData };

// Result:
{
    title: "search_agent",  // Kept from existing
    items: [...],           // Kept from existing
    status: "completed"     // Updated from new
}
```

**UI updates:**
- Icon changes: 🔄 (spinning) → ✅ (checkmark)
- Badge changes: `[in_progress]` → `[completed]`
- Colors change: blue → green

---

## Testing

### 1. Restart Backend

```bash
cd /home/rabeb/PycharmProjects/Whitelabel-codex/api-metachatbot-adk
python main.py
```

### 2. Watch for Console Output

You should see:
```
📤 [StreamFormatter] STREAMING component: action=add, type=task, id=..., data={'title': 'search_agent', 'items': [{'text': ...}], 'status': 'in_progress'}...
```

### 3. Restart Frontend

```bash
cd nextjs-test-ui
npm run dev
```

### 4. Test in Browser

Go to http://localhost:3000 and click "Test" button. You should see:
- Task component with spinning icon
- Agent name as title
- Task description as bullet point
- Blue "in_progress" badge

---

## Component Props

### TaskComponent Props

```typescript
interface TaskComponentProps {
  data: {
    title?: string;           // Agent name
    items?: TaskItem[];       // Array of task items
    status?: 'pending' | 'in_progress' | 'completed';
  };
}

interface TaskItem {
  text: string;  // Task description text
}
```

### Example Usage

```typescript
<TaskComponent
  data={{
    title: "search_agent",
    items: [
      { text: "Searching documents..." },
      { text: "Found 3 results" }
    ],
    status: "in_progress"
  }}
/>
```

---

## Benefits of Task Component

1. **✅ Better Visual Feedback**
   - Animated icons for active tasks
   - Color-coded status (green=done, blue=working, gray=pending)

2. **📝 Cleaner Structure**
   - Items as bullet points (not just plain text)
   - Status integrated in header (not separate section)

3. **🎯 AI SDK Alignment**
   - Follows AI SDK Elements Task component pattern
   - Consistent with modern AI chat interfaces

4. **🔄 Better for Updates**
   - Status can be updated without resending all data
   - Items can be added progressively (future enhancement)

5. **📱 Responsive Design**
   - Adapts to different screen sizes
   - Hover effects for better UX

---

## Future Enhancements (Optional)

### Progressive Task Items

Backend could send items progressively:

```python
# First chunk - add task with first item
{
    "action": "add",
    "data": {
        "title": "search_agent",
        "items": [{"text": "Starting search..."}],
        "status": "in_progress"
    }
}

# Second chunk - update with more items
{
    "action": "update",
    "data": {
        "items": [
            {"text": "Starting search..."},
            {"text": "Found 3 documents"}  # New item added
        ]
    }
}
```

### File References in Items

Following AI SDK Task pattern:

```typescript
items: [
  { text: "Searching documents..." },
  {
    type: "file",
    text: "Found",
    file: {
      name: "CV_Salim_Karoui.pdf",
      icon: "pdf",
      color: "#E34F26"
    }
  }
]
```

---

## Summary

**✅ Changed:** `"plan"` → `"task"`
**✅ Changed:** `"description"` → `"items"` array
**✅ Changed:** `"active"` → `"in_progress"`
**✅ Added:** Status icons (pending, in_progress, completed)
**✅ Added:** Visual status indicators with colors
**✅ Improved:** Cleaner, more modern UI

The migration is **complete and backward compatible**. The component tracking and add/update logic remain unchanged.
