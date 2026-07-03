# User Story: Agent Guardrails — Prompt Injection Protection

> **Epic:** Agent Runtime Safety
> **Feature slug:** `agent-guardrails`
> **Status:** MVP (input + output enforced; tool-call stored/not enforced)
> **Last updated:** 2026-07-03

---

## 1. Summary

As an organization using AI agents in production, I need configurable guardrails that protect agents from prompt injection attacks, data exfiltration, and policy bypasses — so that business users can safely rely on agent responses without a security expert on call.

Guardrails are **configured in the UI** (Admin and per-agent) but **enforced only in the ADK runtime**. The backend persists and forwards settings; it does not perform blocking.

---

## 2. Personas

| Persona | Role | Goal |
|---------|------|------|
| **Business User (Sarah)** | Creates and edits agents for her team | Turn on protection without understanding classifier internals |
| **Administrator (David)** | Manages organization-wide settings and models | Enforce a consistent security baseline across all agents |
| **Security Engineer (Maya)** | Tunes detection prompts and reviews audit logs | Fine-tune what the classifier considers suspicious per phase |

---

## 3. User Stories

### 3.1 Input Guardrail

**As** Sarah (business user),
**I want** my agent to screen incoming user messages for jailbreaks and instruction-override attempts,
**So that** malicious prompts are blocked before the agent acts on them.

**Acceptance Criteria**
- [x] Sarah can toggle "Protect incoming user messages" on the agent Guardrails tab.
- [x] When enabled, every user message is classified before the agent reasons.
- [x] A blocked message returns the configured block message instead of the agent response.
- [x] The decision is logged with phase, source, mode, confidence, and attack type.
- [x] In "Monitor only" mode, suspicious messages are logged but not blocked.
- [x] If no classifier model is configured, the guardrail fails open (allows) and logs a warning.

### 3.2 Output Guardrail

**As** Sarah,
**I want** my agent's final response checked for leaked instructions or sensitive data,
**So that** compromised or manipulated output does not reach end users.

**Acceptance Criteria**
- [x] Sarah can toggle "Review final agent responses" on the agent Guardrails tab.
- [x] When enabled, the final assembled response is classified before being recorded.
- [x] A blocked response is replaced with the configured block message in the recorded result.
- [x] Mode (monitor / balanced / strict) applies the same way as input.
- [ ] *(Future: buffer-then-classify so streamed chunks are held until the guardrail passes.)*

### 3.3 Tool-Call Guardrail (Stored / Not Enforced Yet)

**As** Sarah,
**I want** to configure a policy for risky tool actions,
**So that** once enforcement is implemented, dangerous tool calls are caught before execution.

**Acceptance Criteria**
- [x] Sarah can see the "Review tool actions before execution" card with a "Not enforced yet" badge.
- [x] The toggle is disabled; no runtime blocking occurs.
- [x] The configured policy text and toggle state are persisted and transmitted to ADK.
- [ ] *(Future: tool-call enforcement hooks into the tool execution wrapper.)*

### 3.4 Phase-Specific Detection Prompts

**As** Maya (security engineer),
**I want** separate classifier instructions for input, output, and tool-call phases,
**So that** each phase is tuned to its own risk model instead of one generic prompt.

**Acceptance Criteria**
- [x] Three dedicated prompt fields exist: `inputClassifierPrompt`, `outputClassifierPrompt`, `toolCallClassifierPrompt`.
- [x] Each field has a sensible default initialized on first load.
- [x] ADK selects the correct prompt for the phase being checked.
- [x] Prompts are editable under "Advanced detection instructions" (collapsible section).
- [x] Legacy single `classifierPrompt` from older saved data is mapped into all three phases.

### 3.5 Protection Level

**As** Sarah,
**I want** a simple "Protection level" selector,
**So that** I can choose how aggressively suspicious content is handled.

**Acceptance Criteria**
- [x] Three levels: "Monitor only", "Balanced (recommended)", "Strict".
- [x] Helper text explains: "Balanced is recommended for most business agents."
- [x] Selection applies to all enabled phases.

### 3.6 Block Message

**As** Sarah,
**I want** to customize the message users see when content is blocked,
**So that** it fits my organization's tone.

**Acceptance Criteria**
- [x] Editable on both the agent tab and the admin page.
- [x] Default: "I cannot follow this instruction."
- [x] Helper text: "Users see this message instead of the blocked request or response."

### 3.7 Admin: Force Organization-Wide Guardrails

**As** David (administrator),
**I want** to force guardrail settings across every agent in the organization,
**So that** no agent can be deployed without the baseline protection.

**Acceptance Criteria**
- [x] Admin > Guardrails page has a "Force organization-wide guardrails" toggle.
- [x] When forced, all agents use the admin settings; agent-level settings become read-only.
- [x] Agent dialog shows an amber banner: "Guardrails are managed by your administrator."
- [x] ADK prefers admin config when `forceActivation` is true, regardless of agent-level values.

### 3.8 Admin: Classifier Model Status

**As** David,
**I want** to see whether a classifier model is configured,
**So that** I know guardrails will actually block or just monitor.

**Acceptance Criteria**
- [x] Green status banner when an active model with type `guardrails_classifier` is found.
- [x] Red status banner when no classifier model is configured, explaining fail-open behavior.
- [x] Classifier model is selected from Admin > Models by setting type to `guardrails_classifier`.

### 3.9 Admin: Save Feedback

**As** David,
**I want** a success or error toast when I save guardrail settings,
**So that** I know whether my changes were persisted.

**Acceptance Criteria**
- [x] Success toast: "Guardrails updated."
- [x] Error toast with backend message: "Failed to save guardrails."

---

## 4. Data Flow

```
Admin UI → PUT /admin/guardrails → MongoDB (guardrails_settings)
Agent UI → POST/PUT /agents → MongoDB (agents.guardrails)

Runtime:
  Backend agent.service.ts
    → resolves admin settings + classifier model
    → serializes guardrails_json + guardrails_classifier_model into agent_params
    → gRPC Struct → ADK

  ADK resolve_effective_guardrails()
    → parses guardrails_json (flat agent_params)
    → selects admin_forced or agent config
    → PromptInjectionGuardrail.check_input / check_output / check_tool_call
    → classify_prompt_injection(phase-specific prompt)
    → block / sanitize / monitor / allow
    → audit log
```

---

## 5. Out of Scope (MVP)

- **Tool-call enforcement** — policy is stored and transmitted but no runtime hook exists yet.
- **Pre-stream output buffering** — output guardrail runs on the final assembled response; streamed chunks may reach the user before the block decision in streaming mode.
- **HTML/Visualizer agent output guardrail** — not wired into the HTML agent path.
- **Multi-agent manager output guardrail** — manager-path final response is not covered yet.
- **Rate limiting / cost controls** — every classified message makes one LLM call to the classifier model.

---

## 6. Future Enhancements

1. Implement tool-call enforcement by wrapping the tool execution seam.
2. Buffer-then-classify for streaming output so blocked content never reaches the client.
3. Extend output guardrail coverage to HTML/visualizer and multi-agent manager paths.
4. Configurable classifier timeout (currently hardcoded 3s).
5. Guardrail analytics dashboard (block rate, attack types, false-positive review).
6. Per-agent classifier model override (currently global only).
