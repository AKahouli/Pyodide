# Release Note Summary — `aga-worky-005`

> **Period:** 18 June 2026 – 15 July 2026 (W25–W29)

---

## 1. Playbook & Worky Flow

**Amine GARA** — Playbook flow engine, deterministic builder, Auto Builder, intent engine, Worky stream orchestration (MVP), canvas management, per-stream model selection, intent tracing, designer panel, floating toolbar, node template system, resizable iterator node, blueprint-driven construction, intent blueprint repair/diagnostics, primitive registry, intent graph builder.

**jkhalifa-ys** — Deep search toggle state fix derived from tasks.

**Firas Kahia** — Improved cancellation handling in gRPC services, streamlined review handling in interrupts.

---

## 2. Governance

**Amine GARA** — Governance module scaffold, program management, scope lifecycle, membership services, knowledge center, workspace reconciliation, decision flow, publication, phase0/1/2 implementation, conversation choice components.

**Claude** — Governance cockpit, readiness checklist, scope creation assistant, draft editing for preview/access/channels, workspace-oriented knowledge tab, embedded test conversation.

---

## 3. Workspace

**oussamaknani** — Interactive browse-and-pick link indexing, collected-pages sidebar (trie view, collapsible tree, group by origin), canvas browser viewer, socket hook, crawler removal in favor of interactive browsing, sequential link conversion, WebsiteCrawlerService (sitemap-first), SSRF guard extraction. Public workspaces (visibility toggle, public listing API, hub section/badge, picker integration, owner filter). Link ingestion (URL-to-PDF via Gotenberg, validate-url/link endpoints, type/sourceUrl fields, conversion indicators, upload dropdown with dragged-URL detection, AddLinkDialog with reachability validation). Workspace access check DTO/controller.

**Cyrine Joulak** — Workspace landing page redesigned as agent-style hub.

---

## 4. Browser Session & Web Indexing

**oussamaknani** — Browser session engine (Playwright CDP with screencast, SSRF route guard, engine-agnostic service, shared types/DI tokens, socket.io gateway, idle timer fix, container-safe Chromium args, maxConcurrent 5→10, system Chromium reuse, popup SSRF guard).

---

## 5. Widget & Chat

**Amine GARA** — Self-contained chat widget template (shadow DOM), MCP server config utilities, choice prompts, table rendering, A11y, AI message chart component, greeting message, webchat style fixes.

**baderdinedev** — File display, structured component rendering from gRPC stream, web search sanitization, highlightText color, page number artifact, removed logs, removed sendAutoGreeting.

---

## 6. Conversation & Chain of Thought

**oussamaknani** — Chain of Thought component with rendering logic and localization, CoT integration into ChatMessageBubble, ToolInfoComponent (params field, enhanced rendering, tool execution status reporting), ToolHeader font size.

**Amine GARA** — Conversation sharing with localized UI, PulseProgress.

**rabeb** — Tool_info component streaming, ceph artifact delivery, cleaner ordering; CoT tool title emission.

**baderdinedev** — Persist last mentioned agents across turns (fix #1428).

---

## 7. Agent

**Rayen-ben-slimen** — Configurable temporary child agent settings, mandatory temp child-agent delegation, preserve temp child response payloads, removed default-for-type config.

**Amine GARA** — Admin interface for default agents + global loading indicator, agent delegation factory helper, tool registration refactor, agent configuration types.

**oussamaknani** — Mono-agent resolution and fallback improvement, resolveDefaultMonoAgent, enhanced agent type slug matching.

**Cyrine Joulak** — Agent mention bugfix.

**baderdinedev** — Agent unit test.

---

## 8. User Groups

**oussamaknani** — UserGroup schema/module/DTOs/service/controller/REST API, Groups UI (tab, page, dialog, member input), zustand store with tests, mass-share expansion in share dialog, design spec and implementation plan docs.

---

## 9. WhatsApp Integration

**baderdinedev** — WhatsApp session management auto-reconnect, correct widget template with isolation styles, agent name display, pairing fix, removed WHATSAPP_WORKY_GROUP_PHONE usage, full integration.

**Amine GARA** — WhatsApp integration for agents (connection, pairing, management UI).

---

## 10. Guardrails

**Amine GARA** — Per-agent and global prompt injection guardrails (LLM-based classification, pipeline streaming), gRPC chatbot service architecture, Zod validation schemas, admin-wide enforcement + ADK I/O screening.

---

## 11. Deep Search

**jkhalifa-ys** — Deep search toggle moved to playbook-level toolbar, end-to-end wiring (frontend→NestJS→gRPC→ADK→MCP), amber visual toggle, toast notifications, backend DTO fixes, tool gating fix.

---

## 12. MCP & Connectors

**Cyrine Joulak** — Send email, deploy button, code cleaning.

**rabeb** — X-Agent-Id header for streamable-HTTP connectors (per-agent memory scope).

**jkhalifa-ys** — MCP_LOGICAL_SEARCH_API_KEY injection into streamable_http connector bindings.

**Amine GARA** — Connectors UI fix.

---

## 13. gRPC

**Amine GARA** — gRPC Python bindings generation for chatbot and admin services.

**baderdinedev** — gRPC API key fix (WhatsApp).

**Firas Kahia** — Improved error handling in batch evaluation, MessageToDict refactoring, cancellation handling simplification, async→sync function conversion.

---

## 14. Indexation

**baderdinedev** — Mistral indexing added and later removed (stale auto-indexation fix).

**Cyrine Joulak** — Auto-indexation fix.

**oussamaknani** — UTF-8 filename recovery for multipart uploads.

---

## 15. TTS / STT

**oussamaknani** — Text-to-speech (OpenRouter integration, API endpoints, service, UI voice selection). Speech-to-text transcription.

---

## 16. Model Classification

**Cyrine Joulak** — Added mode field to models.

---

## 17. Web Preview (Manus)

**Cyrine Joulak** — Web preview integration, UI changes, temperature support, search, UT, read-only restrictions, agent memory modal.

---

## 18. Agent Memory

**Cyrine Joulak** — Agent memory modal with dummy data.

**rabeb** — Shared persistent conversation session across agents, sub-agent read-only seeding, removed in-memory session fallback.

---

## 19. M365 / Teams / SharePoint

**ilyasjawhari43** — Removed graph_helpers, Outlook/SharePoint/Teams MCP servers, corrected Elasticsearch type hint, workspace_id injection for Teams MCP, removed unused transport_type param.

**oussamaknani** — M365 webhook handling enhancement, token resolution, subscription handling, external execution detection with polling.

---

## 20. CI / Docker / Sonar

**n-mbarki** — Dockerfile update, ACR image name updates, CI `.claude/` ignore, stale gitlink removal.

**baderdinedev** — Docker backend config, Sonar fixes (regex, random, SMTP, parseInt), unsafe patterns replaced.

**jkhalifa-ys** — Node heap raised for Jest, human_approval test repaired, .gitignore conflict resolved.

**Firas Kahia** — Log token security validation, proto generation path handling.

---

## 21. ADK Upgrade

**rabeb** — google-adk upgraded from 1.18 to 2.3.0.

---

## 22. Worky Error Codes

**oussamaknani** — Error codes updated to new consistent range.

---

## 23. Workspace Permission Webhook

**oussamaknani** — Workspace access check DTO and controller.

---

## 24. Misc Fixes

**Rayen-ben-slimen** — workspace_id injected as header for MCP connectors.

**Amine GARA** — General bugfix.
