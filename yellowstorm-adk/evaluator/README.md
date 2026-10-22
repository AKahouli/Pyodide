# Playbook Flow benchmark evaluator

The evaluator replays every query from `deep_search_benchmark_v2.zip` through
`playbook_flow.PlaybookFlowRuntime.Run`.

## Files to edit

### `config.json`

- `grpc_target`: ADK gRPC server address, normally `localhost:50051`.
- `grpc_secure`: `false` for a local server started with
  `GRPC_ALLOW_INSECURE=true`; otherwise `true`.
- `grpc_root_certificate_path`: path to the server/CA PEM certificate when TLS
  uses a private certificate. This is a certificate, not an API key.
- `grpc_api_key_env`: name of the environment variable containing the shared
  gRPC API key. Keep the value as `GRPC_API_KEY` unless the server uses another
  variable name.
- `request_template_path`: location of the complete Playbook Run request.
- `benchmark_zip_path`: location of the benchmark ZIP.
- `benchmark_queries_member`: query JSON member inside the ZIP.
- `output_directory`: directory receiving results.
- `answer_node_id`: node whose `NodeCompleted` payload is the final answer.
  Leave it `null` to use the last completed node.
- `query_ids`: query IDs to run. An empty array runs all queries.
- `timeout_seconds`: maximum time for one query.
- `query_path`: location where the benchmark query is inserted.
- `session_id_paths`: optional request paths that must receive the fresh
  execution ID to prevent connector/sandbox session reuse.

### `request_template.json`

Replace its complete contents with the `request_payload` object from a
successful:

```text
[gRPC IN] Playbook Run request received
```

The evaluator replaces `execution_id`, clears `seeded_task_outputs`, and
replaces `input_context.query` for every benchmark case.

## API key

The evaluator itself needs at most one API key:

`GRPC_API_KEY` is a shared secret between this evaluator and the ADK gRPC
server. It must be exactly the same value as the `GRPC_API_KEY` environment
variable used when starting the ADK server. The evaluator sends it in the
`x-api-key` gRPC metadata header.

Set it for the current PowerShell session:

```powershell
$env:GRPC_API_KEY = "the-same-value-used-by-the-adk-server"
```

When the server runs locally with `GRPC_ALLOW_INSECURE=true`, it does not enable
the API-key interceptor. In that case no gRPC API key is required.

Do not put LiteLLM, OpenAI, indexing, MCP, storage, or connector keys in
`config.json`. Those credentials belong to the running ADK server and its MCP
services. The evaluator only calls the ADK gRPC endpoint.

## Validate

```powershell
python -m evaluation.evaluator --validate
```

Validation fails while `request_template.json` still contains placeholders.

## Run

Run all queries:

```powershell
python -m evaluation.evaluator
```

Run selected queries:

```powershell
python -m evaluation.evaluator --query-id Q1 --query-id Q5
```

Use another configuration file:

```powershell
python -m evaluation.evaluator --config evaluation/config.json
```

Results are written under `evaluation/outputs/<run timestamp>/`.
