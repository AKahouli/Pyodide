/**
 * Strictly allowlisted, secret-free connector projection for EVERY
 * user-facing or admin-facing response (SEC-02 / WP-02). This is NOT a spread
 * of the stored row: only the fields listed here may leave the server, and
 * secret-capable material (mcpServerConfig, runtimeAuthConfig, credential
 * payloads) can never appear in a response built from this type.
 */
export type ConnectorInspectionStatus = 'supported' | 'unsupported_for_http_inspection';

export class PublicConnectorDto {
  id!: string;
  slug!: string;
  name!: string;
  description!: string;
  icon!: string;
  color!: string;
  iconColor!: 'light' | 'dark';
  categoryId!: string | null;
  /** Resolved category name (populated by list endpoints). */
  categoryName?: string | null;
  authType!: string;
  authConfigSchema!: Record<string, unknown>;
  authSourceType!: string;
  connectedAppKey!: string;
  /** True when server-side credential material is configured (never the material itself). */
  credentialConfigured!: boolean;
  mcpTransportType!: string;
  /** Endpoint URL with any embedded userinfo stripped. */
  mcpServerUrl!: string;
  /** Whether this connector's transport supports backend HTTP inspection. */
  inspectionStatus!: ConnectorInspectionStatus;
  workerPolicy?: import('../connector.types').ConnectorWorkerPolicy;
  dynamicHeaders!: import('../interfaces/connector.interface').IConnectorDynamicHeader[];
  actions!: import('../interfaces/connector.interface').IConnectorActionResponse[];
  referencedSkillIds!: string[];
  isActive!: boolean;
  isSystem?: boolean;
  isHidden?: boolean;
  createdBy!: string;
  createdAt!: Date;
  updatedAt!: Date;
}
