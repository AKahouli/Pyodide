---
id: ADR-0003
status: accepted
scope: sdlc-interaction-and-qa-authentication
source_paths:
  - AGENTS.md
reviewed_at: 2026-10-12
---

# Task autonomy and reusable QA sign-in

## Decision

Ask for clarification only when missing information materially affects the requested outcome, scope, acceptance criteria, or access. The primary agent owns user questions and continues independent work while an answer is pending. Routine implementation, verification, fixes, and delegation proceed within the agreed task without repeated confirmation.

For multiple substantial, independently testable phases, ask once whether to complete the task end to end or pause after each completed, testable phase. Reuse the confirmed current-task choice in every handoff. End-to-end work continues through agreed phases with milestone updates; phase-pause work delivers a verified, testable phase and waits for the user's decision before starting the next. Preserve required verification gates in either mode.

QA uses a persistent browser profile. When sign-in blocks testing, return an actionable `AUTH_REQUIRED` handoff and have the primary agent ask the user once to sign in directly in the QA browser or password manager. Resume the same QA task after confirmation and verify the authenticated UI. Remember the successful non-secret login recipe in Hindsight: app origin/environment, method, supplied account alias/role, profile or credential-store reference, and verification date. Passwords, OTPs, cookies, and tokens remain outside experience memory, Git, and QA evidence. Reuse the recipe and session before asking again; expired access or a changed role can require renewed user action.

## Rationale

Repeated confirmations interrupt delivery. One execution choice keeps substantial phases predictable. Reusing browser state and a verified login recipe avoids repeated access questions while keeping secrets in their existing browser or credential store.

## Verification

Confirm that a settled end-to-end choice does not prompt again for routine steps. A phase-pause choice must stop after the phase's acceptance criteria and required checks pass. An auth blocker must include a URL, profile reference, blocked criteria, and user action; a successful resume must verify authenticated UI and retain unchanged passing evidence. Check the persistent profile setting and record memory only after real sign-in and a successful write. No product sign-in has been performed as part of this harness change.
