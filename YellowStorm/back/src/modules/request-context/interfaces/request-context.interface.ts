export interface RequestContext {
  requestId: string;
  correlationId?: string;
  /** W3C trace id (32 hex) — from the inbound traceparent or generated per request (plan P05). */
  traceId?: string;
  startTime: number;
  userId?: string;
  path: string;
  method: string;
}
