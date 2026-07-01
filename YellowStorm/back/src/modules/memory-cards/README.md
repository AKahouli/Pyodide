# Memory Cards Module

Read/manage **agent memory cards** stored in an external PostgreSQL database
(`thematic_memory`, table `memory_cards_metadata`). The webapp lists an agent's
memories and lets authorized users delete a selection.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Data Source](#data-source)
- [API Endpoints](#api-endpoints)
- [Permissions](#permissions)
- [Configuration](#configuration)
- [Data Model](#data-model)
- [Notes](#notes)

---

## Overview

- **Direct Postgres access**: NestJS connects to the external `thematic_memory`
  DB with the lightweight `pg` driver (no ORM). This replaces the slower
  `webapp → mcp → postgres → mcp → webapp` round-trip with a single
  `webapp → NestJS → postgres` hop.
- **Per-agent scope**: every query is filtered by `agent_id`.
- **View vs delete**: any authorized user can list an agent's memories;
  deletion is restricted to users who can write the agent (owner or a
  `write`-level share). See [Permissions](#permissions).

The browser never talks to Postgres directly — only this server-side module does.

---

## Architecture

```
┌──────────────┐    GET/DELETE /memory-cards     ┌───────────────────────┐
│   Frontend   │ ──────────────────────────────► │ MemoryCardsController │
│ (agent hub)  │                                 └───────────┬───────────┘
└──────────────┘                                             │
                                     canWriteAgent()  ┌───────▼────────┐
                                     (delete only)    │  AgentService  │
                                                      └───────┬────────┘
                                                              │
                                                      ┌───────▼────────────┐
                                                      │ MemoryCardsService │
                                                      │   (pg Pool)        │
                                                      └───────┬────────────┘
                                                              ▼
                                            Postgres `thematic_memory`
                                            table `memory_cards_metadata`
```

---

## Data Source

| Item | Value |
|------|-------|
| Database | `thematic_memory` (external Postgres) |
| Table | `memory_cards_metadata` |
| Scope column | `agent_id` |
| Driver | `pg` (node-postgres) `Pool` |

The pool is created lazily in `onModuleInit` only when `MEMORY_PG_HOST` is set;
otherwise the endpoints return **503** (feature disabled).

---

## API Endpoints

All endpoints require authentication (global `JwtAuthGuard`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/memory-cards?agentId=<id>` | List the agent's memory cards |
| `DELETE` | `/memory-cards?agentId=<id>` | Delete selected cards (body: `{ ids: string[] }`) |

**GET response**
```json
{ "memories": [ /* MemoryCard[] */ ], "total": 5 }
```

**DELETE request / response**
```json
// body
{ "ids": ["mem_1", "mem_2"] }
// response
{ "deleted": 2 }
```

---

## Permissions

- **List**: any authenticated user (the icon is only shown for agents that have
  the `smart-memory` connector — see the Agent module).
- **Delete**: enforced server-side via `AgentService.canWriteAgent(userId, agentId)`:
  - agent **owner** → allowed
  - shared at **`write`** level → allowed
  - shared at **`read`** level, or **default** agents → **403 Forbidden**

The delete SQL is additionally scoped by `agent_id`, so a card can never be
removed from another agent by id.

---

## Configuration

Environment variables (set in the backend `.env`; placeholders in `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORY_PG_HOST` | (empty → feature disabled) | Postgres host |
| `MEMORY_PG_PORT` | `5432` | Postgres port |
| `MEMORY_PG_USER` | - | Postgres user |
| `MEMORY_PG_PASSWORD` | - | Postgres password |
| `MEMORY_PG_DB` | - | Database name (`thematic_memory`) |
| `MEMORY_PG_SSL` | `false` | Set `true` to enable TLS |

Loaded via `config/memory-cards.config.ts` (`registerAs('memoryCards', …)`).

---

## Data Model

`MemoryCardResponse` (returned to the frontend):

```typescript
interface MemoryCardResponse {
  id: string;
  title: string;
  summary: string;
  content: string;
  type: string;
  keywords: string[];        // normalised from text[]/jsonb/"{a,b}"/"a, b"
  valid_from: string | null; // ISO
  valid_until: string | null;
  created_at: string | null;
  updated_at: string | null;
}
```

The service normalises defensively (unknown column types): `keywords` to a
string array, all timestamps to ISO strings.

---

## Notes

- **Secrets**: DB credentials live only in the (gitignored) `.env`. The
  password used during setup was shared in plaintext and should be rotated.
- **Tests**: `memory-cards.service.spec.ts` covers row normalisation and query
  scoping (agent-id filter, `deleteMany` bounds). `canWriteAgent` is covered in
  the Agent module spec.
