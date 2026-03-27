export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    message_v2?: string;
    statusCode: number;
    timestamp: string;
    path: string;
    method: string;
    details?: ErrorDetail[];
    requestId?: string;
  };
}

export interface ErrorDetail {
  field?: string;
  message: string;
  value?: unknown;
}
