# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

YellowStorm primarily serves knowledge teams doing document-heavy research, analysis, content creation, and repeatable business work. Administrators are a supporting audience responsible for configuring access, models, agents, tools, integrations, limits, and governance.

## Product Purpose

YellowStorm helps knowledge teams turn enterprise information into grounded answers, deliverables, and repeatable AI-assisted workflows. Success means users can move from a question or goal to useful work while retaining access control, operational oversight, and traceability.

## Positioning

YellowStorm is an enterprise knowledge fabric: it combines governed company documents, connected applications, semantic context, and cited evidence with configurable AI agents and executable workflows. Its differentiator is not chat alone, but the ability to bring enterprise knowledge into controlled agent work across conversational, playbook, and Chief-of-Staff experiences.

## Operating Context

Users work in an authenticated browser application. They can converse with AI agent teams, organize documents in workspaces, connect external applications, create and execute visual multi-step playbooks, inspect live and historical execution results, and coordinate goal-driven work through Worky. Work can involve streaming output, files, citations, schedules, approvals, clarifications, and human handoffs.

Administrators operate a separate governed area for users, roles, plans, models, tools, skills, connectors, agents, prompts, guardrails, analytics, audit logs, and system settings.

## Capabilities and Constraints

- AI conversations stream structured responses such as text, code, plans, charts, sources, citations, artifacts, and execution status.
- Workspaces provide document context and support retrieval-augmented agent work.
- Connected applications can supply enterprise information and import files into workspaces.
- Playbooks let users create, AI-generate, edit, schedule, execute, monitor, compare, share, and improve multi-step agent workflows.
- Worky provides a Chief-of-Staff workflow with planning, chat, tasks, clarifications, execution controls, reports, memory proposals, budgets, and optional WhatsApp interaction.
- Enterprise governance is essential. The implemented product includes role- and permission-based access, guardrails, budgets and usage limits, human approval points, auditability, and administrative control.
- The system is a multi-service web product: React/Vite frontend, NestJS/MongoDB backend, and a Python agent runtime connected through REST, SSE, Socket.IO, and gRPC boundaries.
- User-facing text is localized through the product's i18n system; English and French resources exist. A durable commitment to both languages is not yet confirmed.

## Evidence on Hand

The repository contains working implementation, tests, module documentation, and protocol definitions for the capabilities above. It does not establish approved customer names, testimonials, market benchmarks, pricing claims, or deployment claims; future product communication must obtain confirmation before presenting any of these as evidence.

## Product Principles

1. Ground AI work in enterprise knowledge and make its sources inspectable.
2. Turn useful conversations into repeatable, executable workflows rather than isolated answers.
3. Keep enterprise governance integral to the work, not bolted on after execution.
4. Preserve user oversight across planning, approvals, clarifications, interruption, and review.
5. Make complex agent activity understandable through live status, structured outputs, history, and audit trails.

## Open Decisions

- Whether the YellowStorm name and current brand identity are binding long-term commitments.
- Whether English and French are both committed support languages.
- The required accessibility standard and any product-specific inclusion needs.
- Approved proof assets and externally publishable product claims.
