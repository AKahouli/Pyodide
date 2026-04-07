## External File Loading

CRITICAL: When you encounter a file reference (e.g., @rules/general.md), use your Read tool to load it on a need-to-know basis. They're relevant to the SPECIFIC task at hand.

Instructions:

- Do NOT preemptively load all references - use lazy loading based on actual need
- When loaded, treat content as mandatory instructions that override defaults
- Follow references recursively when needed

---

## 📚 Documentation Management Protocol

This protocol is **mandatory** and must be executed on every coding operation — no exceptions.
Must never follow this protocol, if your task is not intented to generate or modify code.

### Doc Structure
docs/
├── DOC_INDEX.md ← master dictionary (auto-maintained)
├── CHANGELOG.md ← central changelog (auto-maintained)
└── {feature_slug}/
    ├── README_YYYY-MM-DD_HH-MM-SS.md ← versioned snapshot created at each iteration
    ├── README_YYYY-MM-DD_HH-MM-SS.md ← previous iteration snapshot
    └── ... ← all past snapshots preserved

### DOC_INDEX.md Structure

```markdown
# 📖 Documentation Index

> Auto-maintained by the coding agent. Do not edit manually.
> Last updated: <!-- YYYY-MM-DD HH:MM -->

| Feature Slug  | Description                            | Latest Doc Path                                          | Status    | Last Updated     |
|---------------|----------------------------------------|----------------------------------------------------------|-----------|------------------|
| `auth`        | Authentication & session management    | `/docs/auth/README_2026-03-20_14-30-00.md`               | ✅ stable | 2026-03-20 14:30 |
| `agent-core`  | Core agent orchestration loop          | `/docs/agent-core/README_2026-03-27_09-15-42.md`         | ✅ stable | 2026-03-27 09:15 |
| `playbook`    | Playbook design, execution, and replay | `/docs/playbook/README_2026-03-28_17-05-11.md`           | 🚧 draft  | 2026-03-28 17:05 |
```

---

### 🔍 Pre-Coding Protocol (MANDATORY)

Before writing **any** code, execute these steps in order:

**Step 1 — Consult the Index**

Read `/docs/DOC_INDEX.md` in full. Identify all feature slugs semantically related to the current task by matching on `Feature Slug` and `Description`.
Read the top 15 lines of `/docs/CHANGELOG.md` to keep in mind recent changes just in case.

**Step 2 — Load Relevant Docs**

For each related feature found, read the file listed in its `Latest Doc Path` column. Pay attention to:
- Existing architecture decisions and module boundaries
- User requirements and acceptance criteria
- API contracts and data schemas
- Recent changes recorded at the bottom of the file

If no related feature exists in the index, acknowledge it and proceed to create a new entry in the Post-Coding Protocol.

**Step 3 — Align Before Acting**

Before writing code, verify internally:
- Which existing architectural decisions are being respected
- Which requirements are being addressed
- Whether this task modifies an existing feature or introduces a new one

---

### ✍️ Post-Coding Protocol (MANDATORY)

After completing **any** coding operation, confirm with the user before calling the docs-maintainer agent.

---

### ⚙️ Behavioral Rules

- **Never skip** the Pre-Coding Protocol, even for small fixes or refactors
- **Never delete** any README snapshot — mark deprecated content within a new snapshot using a `> ⚠️ DEPRECATED as of YYYY-MM-DD HH:MM` banner on the affected section
- **Never create** a duplicate slug — check the index first; if it already exists, create a new version (Step 5a) rather than a new feature entry
- **Never mutate** a previously created README file — each file is an immutable snapshot of the state at that iteration
- **Always use** relative paths for cross-references between doc files; when linking to another feature's doc, always link to its **latest** snapshot as listed in `DOC_INDEX.md`
- Doc content must be **factual and code-derived** — no speculation or padding
- `/docs/CHANGELOG.md` must be updated **last**, after all doc files are already written
- **Timestamps must be consistent** — use UTC across all filenames, index entries, file headers, and changelog entries within a session



## 🛠️ Tooling & Environment

- **Repository Shape**: Monorepo split across `YellowStorm/back`, `YellowStorm/front`, and `yellowstorm-adk`
- **Backend**: NestJS 10, Mongoose, gRPC, Jest
- **Frontend**: React 18, Vite, TypeScript, Radix UI, Tailwind CSS, Vitest
- **Agent Runtime / AI Orchestration**: Python 3.12+, LangGraph, Google ADK, Pytest
- **Database**: MongoDB in the NestJS app; additional Python-side persistence may exist in subsystem-specific code
- **Containerization**: Docker, Docker Compose
- **Version Control**: Git
- **Package Managers**: npm for `YellowStorm/back` and `YellowStorm/front`, Poetry where present for Python tooling
- **Testing**: Jest, Vitest, and Pytest depending on the package being changed
- **Documentation**: MkDocs (for user-facing docs), internal Markdown for code docs
- **AI/ML**: OpenAI SDK and agent orchestration tooling used by `yellowstorm-adk`

## 🎯 Coding Standards

- **TypeScript**: Follow the established NestJS and React patterns already present in the package being edited
- **Python**: Follow PEP 8 and existing typing/docstring conventions in `yellowstorm-adk`
- **Type Hinting**: Mandatory for Python function signatures and complex data structures; preserve existing TypeScript typing quality
- **Docstrings**: Keep Python public APIs and modules documented where the surrounding code expects it
- **Comments**: Use sparingly; code should be self-documenting where possible
- **Error Handling**: Graceful error handling with proper exception wrapping and logging
- **Logging**: Structured logging using Python's `logging` module
- **Security**: Never hardcode secrets; use environment variables or secrets management

## OpenCode Agent Team

This repository uses a project-local OpenCode agent configuration in `opencode.json` and `.opencode/agents/`.

### Primary Agents

- `build`: default implementation agent with controlled bash permissions, skill permissions, and delegated specialist access
- `plan`: read-mostly analysis agent for planning, review, and investigation

### Specialist Subagents

- `backend-architect`: use for NestJS module boundaries, gRPC/backend contracts, data flow, and server-side maintainability
- `frontend-ui-ux-designer`: use for React/Vite UI implementation, responsive behavior, and interaction quality
- `browser-qa-engineer`: use for real-browser validation, UI regressions, and Chrome DevTools-driven investigation
- `code-reviewer`: use for bug finding, regression review, maintainability issues, and missing tests; read-only
- `test-engineer`: use for Jest, Vitest, and Pytest coverage, regression tests, and validation
- `security-auditor`: use for auth, validation, secret handling, injection/XSS/SSRF, unsafe trust boundaries, and AI/tool safety; read-only
- `performance-engineer`: use for backend latency, frontend render churn, and workflow/runtime bottlenecks
- `debugger-root-cause`: use to reproduce failures and isolate the minimal root cause before fixing
- `ai-systems-engineer`: use for prompts, routing, context strategy, delegation behavior, and ADK/gRPC workflow reliability
- `refactoring-maintainer`: use for behavior-preserving simplification and module cleanup
- `docs-maintainer`: use for documentation snapshots, changelog/index maintenance, and contributor-facing technical docs

### Skills And Browser Tooling

- The project-level OpenCode configuration explicitly allows the `chrome-devtools` and `ai-elements` skills
- Browser-facing validation should prefer the `chrome-devtools` skill and the project MCP browser tooling when a task affects real UI behavior

### Delegation Guidance

- Prefer `explore` for fast codebase discovery and read-only searches
- Prefer `code-reviewer`, `security-auditor`, and `performance-engineer` for analysis-first tasks before implementation when risk is high
- Prefer `debugger-root-cause` before editing when the user gives a vague bug report or a multi-layer failure
- Prefer `browser-qa-engineer` after frontend changes that affect interaction, layout, or browser runtime behavior
- Prefer `docs-maintainer` after documentation-heavy changes or when syncing docs with implemented behavior
- Keep destructive shell commands gated behind approval even when using `build`

## 🔄 Development Workflow

1. **Branching**: Create a feature branch from `main` (e.g., `feature/new-auth-system`)
2. **Development**: Implement changes following the coding standards
3. **Testing**: Run the relevant package checks for the area changed: `npm test` / `npm run build` in `YellowStorm/back`, `npm test` / `npm run build` in `YellowStorm/front`, and `poetry run pytest` in Python packages when applicable
4. **Documentation**: Update relevant documentation following the documentation management protocol 


## 🧪 Testing Strategy

- **Unit Tests**: Isolate individual components and functions
- **Integration Tests**: Test interactions between components
- **E2E Tests**: Test critical user flows
- **Mocking**: Use the test tooling already established in each package (`jest`, `vitest`, fixtures/mocks in Python)
- **Test Data**: Use fixtures for consistent test data generation

## 📚 Documentation Requirements

- **Code Documentation**: Docstrings for all modules, classes, and functions
- **API Documentation**: Keep NestJS/OpenAPI and backend contract documentation aligned with implemented endpoints and gRPC interfaces
- **User Documentation**: MkDocs site for end-users (if applicable)
- **Architecture Documentation**: High-level architecture diagrams and explanations
- **Changelog**: Keep `CHANGELOG.md` updated with all changes following the documentation management protocol 

## 🚨 Security Guidelines

- **Never commit secrets**: API keys, passwords, tokens should be in `.env` files or secrets manager
- **Input Validation**: Validate all external input (API requests, file uploads)
- **Rate Limiting**: Implement rate limiting on sensitive endpoints
- **Injection Safety**: Use framework-safe database and query patterns, validate filters, and avoid unsafe dynamic query construction
- **XSS Protection**: Sanitize all user-generated content
- **Dependency Scanning**: Regularly scan for vulnerable dependencies

## 📝 Git Commit Messages

Use conventional commits format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`

**Example**:

```
feat(auth): add JWT-based authentication system

Implements JWT authentication with refresh tokens and token validation middleware.

Related to: #123


<!-- context7 -->
Use the `ctx7` CLI to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service -- even well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. This includes API syntax, configuration, version migration, library-specific debugging, setup instructions, and CLI tool usage. Use even when you think you know the answer -- your training data may not reflect recent changes. Prefer this over web search for library docs.

Do not use for: refactoring, writing scripts from scratch, debugging business logic, code review, or general programming concepts.

## Steps

1. Resolve library: `npx ctx7@latest library <name> "<user's question>"`
2. Pick the best match (ID format: `/org/project`) by: exact name match, description relevance, code snippet count, source reputation (High/Medium preferred), and benchmark score (higher is better). If results don't look right, try alternate names or queries (e.g., "next.js" not "nextjs", or rephrase the question)
3. Fetch docs: `npx ctx7@latest docs <libraryId> "<user's question>"`
4. Answer using the fetched documentation

You MUST call `library` first to get a valid ID unless the user provides one directly in `/org/project` format. Use the user's full question as the query -- specific and detailed queries return better results than vague single words. Do not run more than 3 commands per question. Do not include sensitive information (API keys, passwords, credentials) in queries.

For version-specific docs, use `/org/project/version` from the `library` output (e.g., `/vercel/next.js/v14.3.0`).

If a command fails with a quota error, inform the user and suggest `npx ctx7@latest login` or setting `CONTEXT7_API_KEY` env var for higher limits. Do not silently fall back to training data.
<!-- context7 -->
