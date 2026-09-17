export interface AiProxyErrorBody {
  error: {
    message: string;
    type: string;
    param?: string;
    code?: string;
  };
}

export interface LiteLlmErrorResponse {
  error?: {
    message?: string;
  };
}
