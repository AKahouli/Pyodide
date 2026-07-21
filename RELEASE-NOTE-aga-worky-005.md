# Release Note — `aga-worky-005`

> **Period:** 18 June 2026 – 15 July 2026 (W25–W29)
> **Branch:** `aga-worky-005` → `main`
> **Generated:** 16 July 2026

---

## 1. Playbook & Worky Flow

### Amine GARA — W29

- Conversation CoT
- feat: implement playbook flow intent service and workspace governance scope component

### Amine GARA — W28

- feat: implement playbook flow intent service and workspace governance scope component

### Amine GARA — W27

- feat: implement playbook flow engine backend services, ADK runtime, and frontend canvas management system
- feat: implement blueprint-driven intent construction with validation, graph binding, and automated repair services
- feat: implement playbook flow intent module with blueprint repair, construction, and diagnostic services
- feat: implement playbook primitive registry service and intent graph builder to support modular workflow definitions

### Amine GARA — W26

- feat: implement Auto Builder playbook design panel and intent construction services
- feat: implement intent-based playbook flow generation with automated graph building and UI integration
- feat: implement core playbook flow intent engine with graph builder, validator, and intent blueprint services
- feat: implement playbook flow node template system and add UI support for prompt management
- feat: implement playbook canvas handlers and add tool scope validation logic
- Playbook > Deterministic Builder PR2, PR1, refactor
- feat: add resizable iterator node component and supporting control edge serialization logic
- Playbook > Deterministic Builder #1
- feat: add resizable PlaybookIteratorContainerNode component and associated types for managing nested playbook tasks
- feat: implement core playbook flow architecture, including design controllers, intent services, and sharing functionality
- feat: implement playbook intent tracing service with buffered FIFO storage
- feat: implement PlaybookDesignerPanel component for managing intent design and human-in-the-loop feedback workflows
- feat: implement playbook intent flow services
- feat: implement playbook canvas floating toolbar and associated flow management services
- feat: implement intent-driven playbook flow generation services and supporting UI components
- feat: implement playbook flow design architecture with backend services and frontend designer components

### Amine GARA — W25

- feat: implement Worky stream orchestration with automated tool testing and reactive UI components
- feat: implement Worky stream UI, orchestrator panel, and backend planning service with runtime test suite
- Playbook > Prompt reduction > Backend auto generation Worky > UI refact
- feat: implement playbook flow intent builder and system settings administration modules
- feat: implement Worky module with deterministic playbook execution runtime and frontend task management support
- feat: implement Worky planning service and runtime integration for stream message processing and SSE relay
- Worky > 1st stream
- feat(worky): per-stream model selection (orchestrator + workers)
- feat: implement Auto Builder for playbooks with UI and backend integration
- feat(worky): Worky MVP Parts 1-4 (scaffold, plan/apply/execute, Kanban/SSE, ADK runtime, humans, budget, replan, report, memory, trace, hardening)

### jkhalifa-ys — W26

- fix: derive deep search toggle state from tasks instead of playbook.deepSearch

### Firas Kahia — W26

- fix: improve cancellation handling in gRPC services by returning instead of raising on CancelledError
- fix: streamline review handling in handle_interrupt_after by removing unnecessary loop and simplifying logic

---

## 2. Governance

### Amine GARA — W29

- Governance Knowledge center
- feat: implement governance framework for workspace reconciliation and update model configuration DTOs
- Governance > phase0/1/2
- Workspace > Decision Flow

### Amine GARA — W28

- feat: implement agent governance module, conversation choice components, and gRPC communication interfaces
- feat: implement scope-centric governance UI with comprehensive lifecycle management components and backend support services
- feat: implement governance module with program management, scope lifecycles, and membership services
- feat: add governance module scaffold, guidelines, and core UI components
- Governance > Publication
- chore: remove deprecated governance UI/UX implementation plan document

### Amine GARA — W27

- Governance > V0

### Claude — W27

- Gouvernance: test à blanc en vraie conversation embarquée avec choix d'agent
- Gouvernance: onglet Agents aligné sur Savoir, garde-fous, et vraie préparation de publication
- Gouvernance: simplifie Savoir/Accès, embarque le test à blanc en conversation
- Gouvernance: rend Aperçu, Accès et Canaux pleinement éditables en brouillon
- Gouvernance: savoir orienté workspace + édition libre du scope en brouillon
- Gouvernance: comble les ecarts restants avec la maquette (arbre, readiness, apercu)
- Gouvernance (lot C): assistant guide pour la creation d'un scope
- Gouvernance (lot B): checklist de readiness cliquable + actions dry-run/publier dans l'onglet
- Gouvernance: en-tete compact avec selecteur de programme en dropdown
- Gouvernance: corrige l'anneau de readiness invisible + libelles de blocage trompeurs
- Gouvernance: cockpit de gestion + suppression du faux stepper

---

## 3. Workspace

### ousamaknani — W28

- feat(workspace): collapsible tree view for the collected-pages sidebar
- feat(workspace): show collected pages as a path-segment trie
- feat(workspace): group collected pages by origin; show page name + full url
- feat(workspace): interactive browse-and-pick AddLinkDialog; remove PageTree
- feat(workspace): collected-pages sidebar with select/delete/already-indexed
- feat(workspace): canvas browser viewer with input coordinate mapping
- feat(workspace): useBrowserSession socket hook with dedup + blocked notice
- chore(workspace): expose doc type/sourceUrl, drop crawl api + types
- refactor(workspace): remove crawler + page-tree in favor of interactive browsing
- feat(workspace): convert added links strictly sequentially with a delay
- feat(workspace-ui): larger crawl dialog, zoomed preview, name-based tree + filename
- fix(workspace): send descriptive User-Agent on crawl and reachability fetches
- fix(workspace): re-validate SSRF guard on each redirect hop (crawler + reachability)
- fix(workspace-ui): harden preview iframe sandbox; drop unused selectableCount
- feat(workspace-ui): two-phase AddLinkDialog with crawl tree + preview
- feat(workspace-ui): recursive PageTree checkbox component
- feat(workspace-ui): crawl/addLinks api, types, and addPageLinks store action
- feat(workspace): add crawl and bulk-links endpoints + module wiring
- feat(workspace): bulk addLinks with throttled conversion; addLink delegates
- feat(workspace): add page-tree builder with alreadyIndexed marking
- fix(workspace): correct crawler BFS discovery, same-host sitemap sources, and timeout truncation
- feat(workspace): add WebsiteCrawlerService (sitemap-first, crawl fallback)
- refactor(workspace): extract SSRF url-safety guard into a shared util
- docs: add workspace link crawl implementation plan
- docs: add workspace link crawl & multi-page select design spec
- fix(workspace): send URL-to-PDF request as form-urlencoded (Gotenberg wrapper)
- fix(workspace): suppress view/download for not-yet-converted links
- fix(workspace): assign unique placeholder path to link docs (fixes E11000 on path)
- fix(workspace): block SSRF to private/internal addresses in link validation
- fix(workspace): drive link conversion status off doc.status + upfront quota check
- feat(workspace-ui): web icon and conversion indicator for link items
- feat(workspace-ui): upload dropdown (document/link) + dragged-URL detection
- fix(workspace-ui): guard AddLinkDialog against double-submit
- feat(workspace-ui): add link dialog with format + reachability validation
- feat(workspace-ui): add URL detection util and addPageLink store action
- feat(workspace-ui): add link/validate-url api client and types
- feat(classifier): surface document type/sourceUrl in file listing
- feat(workspace): add link and validate-url endpoints
- feat(workspace): add link ingestion (convert URL to PDF) service methods
- feat(workspace): add URL-to-PDF client service and config
- feat(workspace): add type/sourceUrl fields to workspace documents
- docs: add workspace links implementation plan
- docs: add workspace links (website indexing) design spec

### ousamaknani — W27

- fix(workspace): guard null owner in public listing and refresh public cache on toggle
- feat(workspace): show public workspaces in the workspace pickers
- fix(workspace): hide owner actions on read-only public workspace cards
- fix(workspace): add Public option to the hub owner filter dropdown
- feat(workspace): add Public section and badge to the workspaces hub
- fix(workspace): surface errors when toggling workspace visibility
- feat(workspace): add public/private switch to the share dialog
- feat(workspace): add public workspaces store slice and visibility action
- feat(workspace): add public workspaces + visibility API
- feat(workspace): add GET /workspaces/public listing
- feat(workspace): add visibility toggle endpoint and block sharing public workspaces
- feat(workspace): grant public read access in guard and access checks
- feat(workspace): add isPublic flag, response field and error codes
- docs: add Public Workspaces implementation plan
- docs: add Public Workspaces design spec
- feat(workspace): expand a group into pending shares in the share dialog

### Cyrine Joulak — W27

- feat(workspace): redesign landing page as an agent-style hub

### ousamaknani — W27

- Add workspace access check functionality with DTO and controller

---

## 4. Browser Session & Web Indexing

### ousamaknani — W28

- feat(browser-session): add overview documentation for interactive link picking
- chore(browser-session): log connection accept/reject on the gateway
- fix(browser-session): container-safe Chromium args + log start failures
- fix(browser-session): update maxConcurrent sessions from 5 to 10 in tests
- fix(browser-session): increase maxConcurrent sessions from 5 to 10
- fix(browser-session): idle timer ignores frames; destroy prior session on re-start
- chore(browser-session): reuse system Chromium via executablePath; verify suites
- feat(browser-session): socket.io gateway + module wiring
- fix(browser-session): SSRF-guard popups via context.route + replay initial navigation
- feat(browser-session): Playwright CDP engine with screencast + SSRF route guard
- feat(browser-session): engine-agnostic session service with SSRF guard + lifecycle
- feat(browser-session): shared engine types and DI tokens
- feat(config): browser-session limits + sequential conversion delay
- docs(workspace): implementation plan for interactive browse-and-pick indexing
- docs(workspace): design spec for interactive browse-and-pick link indexing

---

## 5. Widget & Chat

### Amine GARA — W29

- feat: implement MCP server config utilities and extend chat widget capabilities with choice prompts, table rendering, and A11y features

### Amine GARA — W28

- feat: implement self-contained chat widget template and shadow DOM initialization logic
- Webchat > Styles fixes AGA
- feat: implement AI message chart component and add comprehensive test suite
- Widget Greeting message

### baderdinedev — W28

- aga(widget): highlightText color
- aga(widget): page number artifact
- feat(widget): remove logs (closes #1408)
- feat(widget): display files
- feat(widget): sanitize web search line in widget text (closes #1408)
- feat(widget): display structured components from the gRPC stream (closes #1418)
- aga(worky): remove sendAutoGreeting template widget chat

---

## 6. Conversation & Chain of Thought

### Amine GARA — W29

- Conversation > PulseProgress
- feat: implement conversation sharing functionality with localized UI and backend service support

### baderdinedev — W29

- fix(conversation): persist last mention agents across turns (closes #1428)

### ousamaknani — W28

- refactor(ChatMessageBubble): update Chain of Thought rendering and styling
- feat(chatConversation): integrate Chain of Thought parts into ChatMessageBubble for improved UI
- refactor(ToolInfoComponent): remove unused ChainOfThoughtComponent definition
- feat(chainOfThought): add Chain of Thought component with rendering logic and localization

### rabeb — W28

- Revert "feat(chatConversation): integrate Chain of Thought parts..."
- Revert "refactor(ChatMessageBubble): update Chain of Thought rendering and styling"
- emit chain_of_thought component of tool titles

### ousamaknani — W28

- feat(toolInfo): update ToolInfoComponent to use optional params field and enhance rendering logic
- feat(toolInfo): add params field to ToolInfoComponent and update related logic
- fix(toolHeader): adjust font size of title in ToolHeader component
- feat(toolInfo): integrate Tool component for enhanced tool execution status reporting
- feat(toolInfo): add ToolInfoComponent for tool execution status reporting

### rabeb — W28

- feat(components): report tool execution via ToolInfoComponent with status
- feat(streaming): tool_info component, ceph artifact delivery, cleaner ordering

---

## 7. Agent

### Rayen-ben-slimen — W29

- refactor(agent): remove default-for-type configuration from frontend

### Amine GARA — W29

- feat: implement admin interface for managing default agents and add global loading indicator component

### Rayen-ben-slimen — W28

- feat(agent): add configurable temporary child agent settings
- feat(adk): add mandatory temporary child-agent delegation (×2)
- fix(adk): preserve temp child response payloads for parent evaluation

### ousamaknani — W28

- fix(agent): improve mono-agent resolution and fallback logic

### ousamaknani — W26

- feat: add resolveDefaultMonoAgent method and update agent resolution logic
- feat: enhance agent type slug matching to support various separators

### Amine GARA — W28

- feat: implement agent configuration types and scaffold core governance and integration modules
- feat: implement agent delegation factory helper and refactor tool registration infrastructure

### baderdinedev — W28

- aga(worky): agent unit test

### Cyrine Joulak — W26

- bugfix mention agent

---

## 8. User Groups

### ousamaknani — W27

- fix(user-group): return NotFound (not Forbidden) for non-owner writes
- feat(groups): add Groups tab, page, dialog and member input
- feat(groups): add zustand store with tests
- feat(groups): add API endpoints, types and client
- feat(user-group): add REST controller
- test(user-group): cover update, delete, null-member drop and dedup
- feat(user-group): add owner-scoped service with tests
- feat(user-group): add DTOs and response interfaces
- feat(user-group): add UserGroup schema, module skeleton and error codes
- docs: add User Groups + mass-share implementation plan
- docs: add User Groups + mass-share design spec

---

## 9. WhatsApp Integration

### baderdinedev — W28

- chore(whatsApp): whatsApp session management auto-reconnect
- chore(whatsApp): correct widget template with isolation styles
- chore(whatsApp): display agent name whatsApp integration
- fix(whatsapp): fix pairing whatsApp PAIRING polls

### Amine GARA — W28

- feat: implement WhatsApp integration for agents with connection, pairing, and management UI

### baderdinedev — W27

- aga(whatsApp): remove usage WHATSAPP_WORKY_GROUP_PHONE
- aga(whatsApp-worky): integration whatsApp

---

## 10. Guardrails

### Amine GARA — W28

- feat: implement per-agent and global prompt injection guardrails with LLM-based classification and pipeline streaming support
- feat: implement gRPC-based chatbot service architecture and agent guardrails system
- feat: add Zod validation schemas for agent guardrails and widget deployment settings
- feat: implement agent guardrails system with admin-wide enforcement and input/output screening in ADK

---

## 11. Deep Search

### jkhalifa-ys — W27

- fix(deep-search): wire toggle end-to-end and fix tool gating

### jkhalifa-ys — W26

- feat: thread deepSearch through upload flow, move graph to workspace, remove hardcoded tool filtering
- fix: deep search toggle reverts after save overwrites local tasks
- feat: wire deep_search_enabled through full chain (frontend → NestJS → gRPC → ADK → MCP)
- fix: use distinct toast messages for deep search on/off state
- feat: amber visual toggle for deep search button (ON=amber highlight, OFF=outline)
- feat: add toast notifications when toggling deep search on/off
- fix: add deepSearch to backend playbook-flow DTOs

### jkhalifa-ys — W25

- feat(playbook): move deep search toggle from per-node to playbook-level floating toolbar
- fix: add missing deep_search param to fake _execute_step in test
- fix: update test expectations for renumbered error codes and new dependencies

---

## 12. MCP & Connectors

### Cyrine Joulak — W26

- add send email
- add deploy button
- code cleaning

### rabeb — W27

- feat: send X-Agent-Id to streamable-HTTP connectors (per-agent memory scope)

### Cyrine Joulak — W26

- feat: inject MCP_LOGICAL_SEARCH_API_KEY into streamable_http connector bindings (jkhalifa-ys)

### Amine GARA — W29

- Connectors UI Fix

---

## 13. gRPC

### Amine GARA — W28

- feat: generate gRPC Python bindings for chatbot and admin services

### baderdinedev — W28

- fix(grpc): fix grpc api key whatsApp

### Firas Kahia — W25

- fix: improve error handling in batch evaluation and refactor MessageToDict usage in gRPC services
- refactor: change async functions to regular functions for user retrieval and improve task cancellation handling in gRPC services
- fix: simplify cancellation handling in gRPC services by removing unnecessary checks for current task state

### Firas Kahia — W26

- fix: ensure toolkit is not None before checking CSRD_BRAIN_ID and simplify text_order assignment in SearchToolkit

---

## 14. Indexation

### baderdinedev — W28

- chore(indexation): remove mistral indexing (closes #1408)
- feat(indexation): add Mistral indexing and fix stale auto-indexation in upload (closes #1408)

### Cyrine Joulak — W26

- fix auto indexation

### ousamaknani — W28

- feat: implement UTF-8 filename recovery for multipart uploads

---

## 15. TTS / STT

### ousamaknani — W26

- feat: implement text-to-speech functionality with OpenRouter integration, including API endpoints, service, and UI controls for voice selection
- feat: add speech-to-text transcription feature

---

## 16. Model Classification

### Cyrine Joulak — W26

- add mode to models

---

## 17. Web Preview (Manus)

### Cyrine Joulak — W27

- remove button and add title
- change front
- supportsTemperature
- update webapp
- fix build
- add search
- update docs
- add UT
- restriction if shared with read only (×2)
- dynamise memory
- create agent memory modal with dummy data

---

## 18. Agent Memory

### Cyrine Joulak — W27

- create agent memory modal with dummy data

### rabeb — W28

- feat(sessions): share one persistent conversation session across agents
- fix(sessions): seed sub-agents read-only instead of writing the shared session
- refactor(sessions): use shared DB session directly, drop seeding and in-memory fallback

---

## 19. M365 / Teams / SharePoint

### ilyasjawhari43 — W25

- feature(api): remove graph_helpers.py file and its associated functions (closes #1343)
- feature(api): Remove MCP servers and related tools for Outlook, SharePoint, and Teams (closes #1343)
- feature(api): correct type hint for Elasticsearch connection in logging function (closes #1343) (×2)
- feature(api): handle workspace_id injection for Teams MCP tools with empty schemas (closes #1343)
- feature(api): remove unused transport_type parameter from workspace params (closes #1343)

### ousamaknani — W26

- feat: enhance webhook handling and update subscription max window for Microsoft Graph
- feat: implement M365 token resolution and subscription handling with correct app key persistence
- feat: add external execution detection with polling mechanism for idle state

---

## 20. CI / Docker / Sonar

### n-mbarki — W29

- Merge pull request #159 from YellowsysOrg/feat/main-dockerfile

### baderdinedev — W29

- feat(docker): back docker

### n-mbarki — W28

- fix(ci): ignore .claude/ dir and remove stale worktree gitlink

### n-mbarki — W27

- Update Azure Container Registry image names (×2)
- Update Docker image repository in workflow

### jkhalifa-ys — W27

- ci(back): raise Node heap for backend Jest suite
- fix(flow-engine): repair human_approval test and scope CI coverage

### baderdinedev — W27

- aga(unit test): add unit test
- aga(unit test): fix adk unit test (×2)
- aga(unit-test): correct unit test

### baderdinedev — W25

- fix(back): replace unsafe regex, random, and SMTP transport patterns
- chore(back): apply Sonar fixes for sort, replaceAll
- chore(parseInt): prefer Number.parseInt over parseInt
- fix(back): prevent regex backtracking DoS in string sanitization

### n-mbarki — W26

- Update sonar.sources to include front/src

### Firas Kahia — W25

- fix: enhance security by validating log tokens and improving path handling in proto generation

### jkhalifa-ys — W26

- merge: resolve .gitignore conflict with main

---

## 21. ADK Upgrade

### rabeb — W27

- aga(deps): upgrade google-adk 1.18 -> 2.3.0

---

## 22. Worky Error Codes

### ousamaknani — W26

- feat: update Worky error codes to new range for consistency and clarity

---

## 23. Workspace Permission Webhook

### ousamaknani — W27

- feat: add workspace access check functionality with DTO and controller

---

## 24. gRPC TLS / Auth

### ousamaknani — W26

- Merge remote-tracking branch 'origin/main' into feature/auth-grpc-tls (n-mbarki)

---

## 25. Misc Fixes

### Rayen-ben-slimen — W26

- fix(adk): adding workspace_id as header for the mcp connectors

### Amine GARA — W27

- fix (general)
