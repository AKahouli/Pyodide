# Playbook Backend API Contracts

## Scope

This document summarizes the main REST and SSE contracts exposed by the Playbook backend.

## REST Endpoints

### CRUD and List

- `POST /playbooks`
- `GET /playbooks`
- `GET /playbooks/:id`
- `PATCH /playbooks/:id`
- `DELETE /playbooks/:id`
- `POST /playbooks/bulk-delete`
- `POST /playbooks/:id/favorite`
- `POST /playbooks/:id/clone`
- `POST /playbooks/:id/clone-share`

### Design

- `POST /playbooks/generate`
- `POST /playbooks/:id/design`
- `GET /playbooks/:id/design-messages`
- `POST /playbooks/:id/design-messages/:msgId/revert`

### Execution

- `GET /playbooks/active-executions`
- `POST /playbooks/:id/execute`
- `POST /playbooks/:id/resume`
- `POST /playbooks/:id/stop`
- `POST /playbooks/:id/skip-step`
- `POST /playbooks/:id/executions/:executionId/rerun-step`
- `POST /playbooks/:id/executions/:executionId/resume-from-step`

### Replay

- `POST /playbooks/:id/tasks/:taskId/validate-replay`
- `GET /playbooks/:id/tasks/:taskId/replays`
- `POST /playbooks/:id/tasks/:taskId/replays/:replayId/activate`
- `PATCH /playbooks/:id/tasks/:taskId/replays/:replayId/format-guide`

### Output Format

- `POST /playbooks/:id/tasks/:taskId/output-format-template`
- `GET /playbooks/:id/tasks/:taskId/output-format-template`
- `PATCH /playbooks/:id/tasks/:taskId/output-format-template`

### History

- `GET /playbooks/:id/executions`
- `GET /playbooks/:id/executions/:execId`

## SSE Endpoint

- `GET /playbooks/stream?token=<jwt>`

## Important SSE Events

- `playbook_connected`
- `playbook_heartbeat`
- `playbook_execution_start`
- `playbook_step_start`
- `playbook_step_complete`
- `playbook_step_evaluation_updated`
- `playbook_replay_format_guide_updated`
- `playbook_output_format_template_updated`
- `playbook_execution_complete`
- `playbook_execution_error`
- `playbook_interrupt`
- `playbook_shared`

## Contract Notes

- SSE uses query-token authentication because browser `EventSource` cannot send bearer headers.
- `playbook_connected` is also used as a catch-up point for active executions.
- `playbook_step_complete` now carries richer metadata such as tool trace, prompt trace, and semantic match data.
- replay and output-format endpoints are task-scoped, not playbook-wide.

