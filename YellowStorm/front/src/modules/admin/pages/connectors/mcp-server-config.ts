export interface ParsedMcpServerConfig {
  githubPatToken: string;
  serverConfigText: string;
}

function extractGithubPatToken(config: Record<string, unknown>): string {
  if (typeof config.githubPat === 'string' && config.githubPat.trim()) {
    return config.githubPat.trim();
  }

  const headers = config.headers;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    return '';
  }

  const authorization = (headers as Record<string, unknown>).Authorization;
  if (typeof authorization !== 'string') {
    return '';
  }

  const bearerPrefix = 'Bearer ';
  return authorization.startsWith(bearerPrefix) ? authorization.slice(bearerPrefix.length).trim() : '';
}

export function parseMcpServerConfig(config?: Record<string, unknown>): ParsedMcpServerConfig {
  if (!config || Object.keys(config).length === 0) {
    return {
      githubPatToken: '',
      serverConfigText: '',
    };
  }

  const githubPatToken = extractGithubPatToken(config);
  const sanitizedConfig = { ...config };
  delete sanitizedConfig.githubPat;

  if (githubPatToken) {
    const headers = sanitizedConfig.headers;
    if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
      const sanitizedHeaders = { ...(headers as Record<string, unknown>) };
      delete sanitizedHeaders.Authorization;
      sanitizedConfig.headers = sanitizedHeaders;

      if (Object.keys(sanitizedHeaders).length === 0) {
        delete sanitizedConfig.headers;
      }
    }
  }

  return {
    githubPatToken,
    serverConfigText: Object.keys(sanitizedConfig).length > 0 ? JSON.stringify(sanitizedConfig, null, 2) : '',
  };
}

export function buildMcpServerConfig(
  serverConfigText: string,
  githubPatToken: string,
): Record<string, unknown> | undefined {
  const parsedConfig = serverConfigText.trim() ? (JSON.parse(serverConfigText) as Record<string, unknown>) : {};
  const trimmedGithubPatToken = githubPatToken.trim();

  if (trimmedGithubPatToken) {
    parsedConfig.githubPat = trimmedGithubPatToken;
  } else {
    delete parsedConfig.githubPat;
  }

  return Object.keys(parsedConfig).length > 0 ? parsedConfig : undefined;
}
