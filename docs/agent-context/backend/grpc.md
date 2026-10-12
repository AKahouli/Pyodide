# gRPC and ADK contracts

Read only the sections needed for the changed behavior. Paths such as `src/`, `drizzle/` and `package.json` are relative to `YellowStorm/back/`; `front/` means `YellowStorm/front/`. Verify descriptive inventories and known debt against current source before relying on them.

## 10. gRPC & Microservices

**Proto files** live in `src/modules/<module>/proto/`. Currently five proto files:

| Module | File | Service | RPCs |
|--------|------|---------|------|
| `agent` | `a2a_admin.proto` | A2A admin | Admin/runtime integration |
| `conversation` | `chatbot.proto` | Messages only | — (shared types) |
| `conversation-v2` | `conversation.proto` | `ConversationV2` | 7 RPCs |
| `playbook-flow` | `playbook-flow.proto` | `PlaybookFlowRuntime` | 5 RPCs |
| `worky` | `companion_ai.proto` | Companion AI orchestrator | Worky orchestration |

Any `.proto` consumed by YellowStorm ADK must be mirrored in `yellowstorm-adk/grpc/proto/` and changed on both sides in one change set. The current ADK tree mirrors `a2a_admin.proto`, `chatbot.proto`, `playbook-flow.proto`, and `companion_ai.proto`; it does not contain `conversation.proto`. Treat that absence as unresolved ownership/contract debt: verify the Conversation V2 server owner before changing the proto, and add the ADK mirror if ADK is the receiver.

**Packaging:** every backend `.proto` needed at runtime must be available from a standalone `dist/` artifact and from the production image. `nest-cli.json` declares `**/*.proto`; `package.json`'s `postbuild` explicitly copies `chatbot.proto`, `conversation.proto`, `playbook-flow.proto`, and `companion_ai.proto`; the Dockerfile explicitly copies all five proto directories. `a2a_admin.proto` is currently omitted from the explicit `postbuild` copy and was absent from a standalone local `dist/` after `npm run build`, although Docker compensates for it. Fix that build-artifact gap before relying on `dist/` outside the Docker image. When adding a proto, verify Nest assets, `postbuild`, the Docker image, and runtime path resolution.

**Backend acts as gRPC client** for ADK-backed services. Clients are built in services (e.g. `PlaybookFlowRuntimeClientService`, `ConversationV2ClientService`) via `OnModuleInit` using `@grpc/grpc-js` + `@grpc/proto-loader`.

Worky uses the gRPC ADK orchestrator and Electric projections. Keep its sender, receiver, and projection contracts aligned when changing the orchestration flow.

**Streams:** Map gRPC stream events to RxJS `Observable`/`Subject`. Always handle `error`, `end`, disconnect. Translate gRPC codes to domain error codes — never leak raw gRPC codes to frontend.

**`google.protobuf.Struct`:** `@grpc/proto-loader` does NOT auto-convert plain JS objects to Struct wire format. Always wrap with the module's `toGrpcStruct()` before assigning to a Struct-typed field. Known Struct/payload-style fields include `task_metadata`, `evaluation_config`, `trigger_context`, `agent_params`, `args`, `metadata`, `input_context`, and `payload`; verify the proto before adding or editing any Struct assignment. A missed wrap causes a silent empty field on the Python side with no log or error.

**Prompt-facing paths:** Any workspace/document path that flows into an LLM prompt or ADK trigger context must strip the leading Mongo ObjectId owner segment. Keep path sanitisation consistent across document paths, workspace path metadata, and trigger context paths.
