export interface RequestContext {
  requestId: string;
  correlationId?: string;
  startTime: number;
  userId?: string;
  path: string;
  method: string;
}
