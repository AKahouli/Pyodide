# Component Tracking Print Statements

## What Was Added

I've added print statements in your backend API to track when components are added to the ComponentTracker.

---

## Location 1: ComponentTracker - get_action()

**File:** `src/smart_rag/messaging/component_tracker.py:32-45`

```python
def get_action(self, agent_id: str) -> str:
    """Determine if action should be 'add' or 'update' for this agent."""
    if agent_id not in self.agent_components or not self.agent_components[agent_id]:
        # First component from this agent
        action = "add"
        print(f"🆕 [ComponentTracker] ACTION='add' for agent_id={agent_id} (first component)")
        return action
    action = "update"
    print(f"🔄 [ComponentTracker] ACTION='update' for agent_id={agent_id} (existing component)")
    return action
```

**Output examples:**
```
🆕 [ComponentTracker] ACTION='add' for agent_id=6964c7e915f75336d1b88f24 (first component)
🔄 [ComponentTracker] ACTION='update' for agent_id=6964c7e915f75336d1b88f24 (existing component)
```

---

## Location 2: ComponentTracker - register_component()

**File:** `src/smart_rag/messaging/component_tracker.py:46-70`

```python
def register_component(self, agent_id: str, component_id: str = None) -> str:
    """Register a component for an agent and return the component ID."""
    if component_id is None:
        component_id = str(uuid.uuid4())

    if agent_id not in self.agent_components:
        self.agent_components[agent_id] = set()

    self.agent_components[agent_id].add(component_id)
    self._current_component_ids[agent_id] = component_id

    component_count = len(self.agent_components[agent_id])
    print(f"📝 [ComponentTracker] REGISTERED component_id={component_id} for agent_id={agent_id} (total: {component_count})")
    logger.debug(f"[ComponentTracker] Registered component {component_id} for agent {agent_id}")
    return component_id
```

**Output examples:**
```
📝 [ComponentTracker] REGISTERED component_id=abc-123-def for agent_id=6964c7e915f75336d1b88f24 (total: 1)
📝 [ComponentTracker] REGISTERED component_id=ghi-456-jkl for agent_id=6964c7e915f75336d1b88f24 (total: 2)
```

---

## Location 3: StreamFormatter - format_component_event()

**File:** `src/smart_rag/messaging/formatters.py:70-94`

```python
def format_component_event(self, agent_id: str, component_type: str,
                          component_data: Dict[str, Any], message_id: str) -> Dict[str, Any]:
    """Format a streaming event using the new component-based structure."""
    # Determine action (add or update) and component ID
    if self.component_tracker:
        action = self.component_tracker.get_action(agent_id)
        component_id = self.component_tracker.get_current_component_id(agent_id)

        # If this is the first chunk from this agent, register it
        if action == "add":
            self.component_tracker.register_component(agent_id, component_id)
    else:
        # Fallback if no tracker (always add, generate new ID)
        action = "add"
        component_id = str(uuid.uuid4())

    # Print component streaming info
    data_preview = str(component_data)[:100] if component_data else "{}"
    print(f"📤 [StreamFormatter] STREAMING component: action={action}, type={component_type}, id={component_id}, agent={agent_id}, data={data_preview}...")

    return {
        "action": action,
        "component": {
            "id": component_id,
            "type": component_type,
            "data": component_data
        },
        "metadata": {
            "message_id": message_id,
            "agent_id": agent_id
        }
    }
```

**Output examples:**
```
📤 [StreamFormatter] STREAMING component: action=add, type=plan, id=abc-123, agent=6964c7e915f75336d1b88f24, data={'title': 'Search Agent', 'description': 'Searching documents...', 'status': 'active'}...
📤 [StreamFormatter] STREAMING component: action=update, type=text, id=abc-123, agent=6964c7e915f75336d1b88f24, data={'content': 'I found 3 documents'}...
```

---

## How to See the Prints

### 1. Start your gRPC server

```bash
cd /home/rabeb/PycharmProjects/Whitelabel-codex/api-metachatbot-adk
python main.py
```

### 2. In another terminal, start the proxy

```bash
python grpc_proxy_server.py
```

### 3. In another terminal, start Next.js

```bash
cd nextjs-test-ui
npm run dev
```

### 4. Open browser and test

Go to http://localhost:3000 and click "Test" button.

### 5. Watch the Python terminal

You'll see output like:

```
🆕 [ComponentTracker] ACTION='add' for agent_id=6964c7e915f75336d1b88f24 (first component)
📝 [ComponentTracker] REGISTERED component_id=abc-123-def-456 for agent_id=6964c7e915f75336d1b88f24 (total: 1)
📤 [StreamFormatter] STREAMING component: action=add, type=plan, id=abc-123-def-456, agent=6964c7e915f75336d1b88f24, data={'title': 'search_agent', 'description': 'Say hello to the user as the search agent.', 'status': 'activ...

🔄 [ComponentTracker] ACTION='update' for agent_id=6964c7e915f75336d1b88f24 (existing component)
📤 [StreamFormatter] STREAMING component: action=update, type=text, id=abc-123-def-456, agent=6964c7e915f75336d1b88f24, data={'content': 'Hello! I am the search agent, here to help you find the information you need. How can I...

🔄 [ComponentTracker] ACTION='update' for agent_id=6964c7e915f75336d1b88f24 (existing component)
📤 [StreamFormatter] STREAMING component: action=update, type=plan, id=abc-123-def-456, agent=6964c7e915f75336d1b88f24, data={'status': 'completed'}...
```

---

## What Each Print Shows

### 🆕 ACTION='add'
- **Meaning:** This is the **first time** this agent is sending a component
- **Frontend effect:** A **new component** will be created in the UI
- **ComponentTracker:** Agent is not yet in the tracker

### 🔄 ACTION='update'
- **Meaning:** This agent has **already sent** a component before
- **Frontend effect:** An **existing component** will be updated in the UI
- **ComponentTracker:** Agent is already tracked

### 📝 REGISTERED
- **Meaning:** Component ID is now **registered** in the tracker for this agent
- **Shows:** Component ID, agent ID, and total component count for this agent
- **ComponentTracker:** Component is added to `agent_components[agent_id]` set

### 📤 STREAMING
- **Meaning:** Component is being **formatted and sent** to the proxy/frontend
- **Shows:** Full component details (action, type, ID, agent, data preview)
- **Next step:** This data goes to gRPC → proxy → Next.js → React UI

---

## Execution Flow

```
User clicks "Test" button
  ↓
Frontend sends: @search agent hello
  ↓
Backend starts processing
  ↓
[1] 🆕 ACTION='add' for search agent (first component)
  ↓
[2] 📝 REGISTERED component_id=abc-123 (total: 1)
  ↓
[3] 📤 STREAMING component: action=add, type=plan, data={...}
  ↓
[4] 🔄 ACTION='update' for search agent (existing)
  ↓
[5] 📤 STREAMING component: action=update, type=text, data={...}
  ↓
[6] 🔄 ACTION='update' for search agent (existing)
  ↓
[7] 📤 STREAMING component: action=update, type=plan, status=completed
  ↓
Frontend receives all chunks and renders components
```

---

## Debugging Tips

### Find component tracking issues:

```bash
# Watch only component tracker prints
python main.py 2>&1 | grep "ComponentTracker"

# Watch only streaming prints
python main.py 2>&1 | grep "StreamFormatter"

# Watch all component-related prints
python main.py 2>&1 | grep -E "🆕|🔄|📝|📤"
```

### Check if components are being registered:

Look for the print:
```
📝 [ComponentTracker] REGISTERED component_id=... (total: X)
```

If you see `total: 1, 2, 3...` incrementing, components are being tracked correctly.

### Check if add/update logic is working:

- First message from agent → Should see `🆕 ACTION='add'`
- Subsequent messages → Should see `🔄 ACTION='update'`

If you see multiple `🆕 ACTION='add'` for the same agent, something is wrong with the tracker.

---

## Summary

**3 print locations added:**

1. ✅ `component_tracker.py:get_action()` - Shows when action is determined (add vs update)
2. ✅ `component_tracker.py:register_component()` - Shows when component is registered
3. ✅ `formatters.py:format_component_event()` - Shows when component is streamed to frontend

**What you'll see:**
- 🆕 First component from agent
- 🔄 Update to existing component
- 📝 Component registered in tracker
- 📤 Component being streamed to frontend

Now restart your Python server and test to see these prints in action!
