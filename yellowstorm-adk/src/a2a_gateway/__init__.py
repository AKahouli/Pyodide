"""A2A gateway: publish a mono-agent over the A2A protocol.

Turns an agent definition (the `Agent` proto, sent at publish time by the
frontend "Generate A2A endpoint" button) into a per-agent A2A endpoint backed
by the RunSingleAgent gRPC service. Definitions are persisted in Postgres
(`a2a_agents`), protected by a per-agent API key, and served on parameterized
routes mounted in the main FastAPI app:

  POST /a2a-admin/agents                       -> publish (returns url + key)
  GET  /a2a/{agent_id}/.well-known/agent-card.json
  POST /a2a/{agent_id}                          -> A2A JSON-RPC (key required)
"""
