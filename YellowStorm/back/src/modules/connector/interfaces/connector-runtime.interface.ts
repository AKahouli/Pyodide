import type { ConnectorRow } from '../persistence/connector.store';

/**
 * SERVER-ONLY connector definition: the raw stored row including
 * secret-capable material (runtimeAuthConfig, mcpServerConfig, auth config).
 * Values of this type must never be returned from an HTTP response — user and
 * admin responses use the allowlisted PublicConnectorDto instead. Server-side
 * consumers (ADK/gRPC binding, MCP runtimes, transfer adapters, token
 * issuance) resolve credentials through methods returning this type.
 */
export type RuntimeConnectorDefinition = ConnectorRow;
