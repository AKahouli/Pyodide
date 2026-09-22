/** Plain integration types (remediation 4.1) — moved out of user-app-connection.schema.ts. */
export enum ConnectionStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  ERROR = 'error',
  REVOKED = 'revoked',
}
