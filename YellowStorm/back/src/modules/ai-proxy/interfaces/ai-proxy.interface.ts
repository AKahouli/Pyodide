export interface AiProxyErrorBody {
  error: {
    message: string;
    type: string;
    param?: string;
    code?: string;
  };
}
