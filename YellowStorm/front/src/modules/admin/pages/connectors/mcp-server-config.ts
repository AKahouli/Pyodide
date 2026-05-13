export interface ParsedMcpServerConfig {
  serverConfigText: string;
}

export function parseMcpServerConfig(config?: Record<string, unknown>): ParsedMcpServerConfig {
  if (!config || Object.keys(config).length === 0) {
    return {
      serverConfigText: '',
    };
  }

  const sanitizedConfig = { ...config };
  delete sanitizedConfig.githubPat;

  const headers = sanitizedConfig.headers;
  if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
    const sanitizedHeaders = { ...(headers as Record<string, unknown>) };
    delete sanitizedHeaders.Authorization;
    sanitizedConfig.headers = sanitizedHeaders;

    if (Object.keys(sanitizedHeaders).length === 0) {
      delete sanitizedConfig.headers;
    }
  }

  return {
    serverConfigText: Object.keys(sanitizedConfig).length > 0 ? JSON.stringify(sanitizedConfig, null, 2) : '',
  };
}
