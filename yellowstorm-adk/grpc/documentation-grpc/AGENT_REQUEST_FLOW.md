# Agent Request Flow - Both Agents Are Sent

## ✅ Yes, Both Agents Are Sent in Every Request

When you click "Test" and send `@search agent hello`, **BOTH agents** are included in the request payload.

---

## Request Structure

### Frontend → API Route

**File:** `nextjs-test-ui/app/api/chat/route.ts:39-64`

```json
{
  "query": "@search agent hello",
  "user_id": "68d2643e7be4951a53bcad6a",
  "username": "user@yellowstorm.com",
  "conversation_id": "test-conv-1234567890",
  "agent_mode": "manual",
  "workspace_id": "6939a284c3da8df2a504c595",
  "workspace_documents": [...],
  "agents": [
    {
      "id": "6964c7e915f75336d1b88f23",
      "name": "my manager",
      "description": "you are the manager",
      "prompt": "your name is VISVIS. You are a CREATIVE manager agent.",
      "agent_type": "manager",
      "save_memory": false,
      "chatbot": {
        "name": "gpt-4.1",
        "prompt": "You are a helpful AI assistant"
      }
    },
    {
      "id": "6964c7e915f75336d1b88f24",
      "name": "search agent",
      "description": "you are the search agent",
      "prompt": "your name is SearchBot. You are a search specialist agent.",
      "agent_type": "simple",
      "save_memory": false,
      "chatbot": {
        "name": "gpt-4.1",
        "prompt": "You are a helpful AI assistant"
      }
    }
  ]
}
```

**Key point:** The `agents` array contains **BOTH** agents, even though the query targets only one.

---

## Proxy Conversion

### HTTP JSON → gRPC Protobuf

**File:** `grpc_proxy_server.py:54-72`

```python
# Build agents
agents = []
for agent_data in http_data.get("agents", []):
    chatbot = None
    if agent_data.get("chatbot"):
        chatbot = chatbot_pb2.Chatbot(
            name=agent_data["chatbot"].get("name", ""),
            prompt=agent_data["chatbot"].get("prompt", "")
        )

    agents.append(chatbot_pb2.Agent(
        id=agent_data.get("id", ""),
        name=agent_data.get("name", ""),
        description=agent_data.get("description", ""),
        prompt=agent_data.get("prompt", ""),
        agent_type=agent_data.get("agent_type", "simple"),
        save_memory=agent_data.get("save_memory", False),
        chatbot=chatbot
    ))
```

**Result:** All agents from the HTTP request are converted to protobuf `Agent` messages.

---

## Backend Processing

### gRPC Request to Backend

**File:** Backend receives protobuf `RunAgentTeamRequest`

```protobuf
RunAgentTeamRequest {
  user_context: {
    user_id: "68d2643e7be4951a53bcad6a"
    username: "user@yellowstorm.com"
  }
  conversation_id: "test-conv-1234567890"
  query: "@search agent hello"
  agent_mode: "auto"
  workspace_context: { ... }
  agents: [
    Agent {
      id: "6964c7e915f75336d1b88f23"
      name: "my manager"
      agent_type: "manager"
      ...
    },
    Agent {
      id: "6964c7e915f75336d1b88f24"
      name: "search agent"
      agent_type: "simple"
      ...
    }
  ]
}
```

---

## Backend Routing Logic

### How @agent_name Works

**File:** `src/smart_rag/engines/multi_agent/team_orchestrator.py`

When the backend receives the request:

1. **Parse the query:** `@search agent hello`
   - Extracts: `agent_name = "search agent"`
   - Extracts: `actual_query = "hello"`

2. **Find matching agent:**
   - Loops through all agents in the request
   - Finds agent with `name == "search agent"`
   - Uses that agent's configuration

3. **Route to agent:**
   - Only the matched agent processes the query
   - Other agents are available but not used

### Code Example (simplified):

```python
def process_query(query: str, agents: List[Agent]):
    # Parse @agent_name pattern
    if query.startswith("@"):
        agent_name, actual_query = parse_agent_directive(query)
        # Find the agent
        target_agent = find_agent_by_name(agent_name, agents)
        # Route to that agent only
        return target_agent.run(actual_query)
    else:
        # Use manager for routing
        return manager.coordinate(query, agents)
```

---

## Why Both Agents Are Sent

### Reason 1: Manager Coordination

If you don't specify `@agent_name`, the **manager agent** needs to know about all available agents to coordinate them:

```
Query: "Find sales data and analyze it"
Manager sees both agents:
  → Assigns "search agent" to find data
  → Could assign another agent to analyze
```

### Reason 2: Multi-Agent Workflows

Some queries may need multiple agents working together:

```
Query: "@my manager coordinate a search task"
Manager agent:
  → Sees "search agent" is available
  → Delegates subtask to search agent
  → Both agents work on the same request
```

### Reason 3: Agent Context

Agents may need to know about each other for:
- Delegation
- Coordination
- Understanding available capabilities

---

## Request Flow Diagram

```
User types: "@search agent hello"
  ↓
Next.js API Route
  ↓
Sends BOTH agents in request:
  {
    query: "@search agent hello",
    agents: [
      "my manager",      ← Sent but not used
      "search agent"     ← Sent and used
    ]
  }
  ↓
gRPC Proxy
  ↓
Converts to protobuf with BOTH agents
  ↓
Backend Team Orchestrator
  ↓
Parses "@search agent" directive
  ↓
Finds "search agent" in agents array
  ↓
Routes query to "search agent" only
  ↓
"search agent" processes "hello"
  ↓
Components stream back to frontend
```

---

## Testing This

### Add print to see which agents are sent:

**File:** `grpc_proxy_server.py:54-72`

```python
# Build agents
agents = []
for agent_data in http_data.get("agents", []):
    print(f"🔧 [Proxy] Building agent: name={agent_data.get('name')}, type={agent_data.get('agent_type')}")

    chatbot = None
    if agent_data.get("chatbot"):
        chatbot = chatbot_pb2.Chatbot(
            name=agent_data["chatbot"].get("name", ""),
            prompt=agent_data["chatbot"].get("prompt", "")
        )

    agents.append(chatbot_pb2.Agent(
        id=agent_data.get("id", ""),
        name=agent_data.get("name", ""),
        description=agent_data.get("description", ""),
        prompt=agent_data.get("prompt", ""),
        agent_type=agent_data.get("agent_type", "simple"),
        save_memory=agent_data.get("save_memory", False),
        chatbot=chatbot
    ))

print(f"🔧 [Proxy] Total agents in request: {len(agents)}")
```

**Output:**
```
🔧 [Proxy] Building agent: name=my manager, type=manager
🔧 [Proxy] Building agent: name=search agent, type=simple
🔧 [Proxy] Total agents in request: 2
```

---

## How to Send Only One Agent

If you want to send only the search agent, edit the API route:

**File:** `nextjs-test-ui/app/api/chat/route.ts:39-64`

```typescript
agents: [
  // Comment out or remove the manager agent
  // {
  //   id: "6964c7e915f75336d1b88f23",
  //   name: "my manager",
  //   ...
  // },
  {
    id: "6964c7e915f75336d1b88f24",
    name: "search agent",
    description: "you are the search agent",
    prompt: "your name is SearchBot. You are a search specialist agent.",
    agent_type: "simple",
    save_memory: false,
    chatbot: {
      name: "gpt-4.1",
      prompt: "You are a helpful AI assistant"
    }
  }
]
```

**Result:** Only "search agent" is sent in the request.

**Note:** This may break manager coordination features if you try to use them.

---

## Benefits of Sending Both Agents

### 1. Flexibility
User can switch between agents mid-conversation:
```
"@search agent find sales data"
"@my manager coordinate the analysis"
```

### 2. Manager Coordination
Manager can see all available agents and delegate tasks:
```
"@my manager find and analyze sales trends"
Manager → Delegates search to "search agent"
       → Could delegate analysis to another agent
```

### 3. Consistent API
Every request has the same structure, regardless of which agent is targeted.

---

## Summary

✅ **Both agents ARE sent** in every request
✅ Backend routing decides which agent actually processes the query
✅ Using `@agent_name` explicitly routes to that agent
✅ Without `@agent_name`, manager coordinates all agents
✅ This design supports multi-agent workflows and manager coordination

**Current behavior:**
```
Query: "@search agent hello"
Agents sent: ["my manager", "search agent"]
Agent used: "search agent"
```

If you want to change this, you can:
1. Remove agents from the API route configuration
2. Add dynamic agent selection based on user preferences
3. Keep it as-is for maximum flexibility

The current setup is **correct and intentional** for supporting both simple agent queries and complex multi-agent coordination! 🎯
