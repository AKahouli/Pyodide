import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface DeployResponse {
  url: string;
}

// TODO: temporary hardcoded fallback requested for local debugging — remove
// before commit; env vars APP_BUILDER_DEPLOY_BASE_URL / APP_BUILDER_DEPLOY_TOKEN
// must remain the source of truth.
const FALLBACK_DEPLOY_BASE_URL = 'https://sandbox-v2.yellowsys.org/';
const FALLBACK_DEPLOY_TOKEN =
  '4130522f186a5b617fa886e760ca7492b8084dee93dc024614e48c6af9b007a4';

// App-builder deployments can take a long time (build + publish); give the
// upstream up to 3 minutes before aborting the request.
const DEPLOY_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Deploys a conversation application through the configured app-builder service.
 */
@Injectable()
export class ConversationV2DeployService {
  private readonly logger = new Logger(ConversationV2DeployService.name);

  constructor(private readonly config: ConfigService) {}

  async deploy(userId: string, conversationId: string): Promise<DeployResponse> {
    const baseUrl =
      this.config.get<string>('conversationV2.appBuilderDeployBaseUrl') ||
      FALLBACK_DEPLOY_BASE_URL;
    const token =
      this.config.get<string>('conversationV2.appBuilderDeployToken') || FALLBACK_DEPLOY_TOKEN;

    const endpoint = new URL('app/deploy', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
          conversation_id: conversationId,
        }),
        signal: AbortSignal.timeout(DEPLOY_TIMEOUT_MS),
      });
    } catch (error) {
      if ((error as Error).name === 'TimeoutError') {
        this.logger.error(
          `App-builder deployment timed out after ${DEPLOY_TIMEOUT_MS / 1000}s`,
        );
        throw new ServiceUnavailableException('Deployment service timed out');
      }
      this.logger.error(`App-builder deployment request failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException('Deployment service is unavailable');
    }

    // Read as text first so the raw payload can be logged even when it is not valid JSON.
    const rawBody = await response.text();
    this.logger.log(
      `App-builder deployment response: status=${response.status} headers=${JSON.stringify(
        Object.fromEntries(response.headers.entries()),
      )} body=${rawBody}`,
    );

    if (!response.ok) {
      this.logger.warn(`App-builder deployment failed with status ${response.status}`);
      throw new ServiceUnavailableException('Deployment service rejected the request');
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      this.logger.warn('App-builder deployment returned malformed JSON');
      throw new ServiceUnavailableException('Deployment service returned an invalid response');
    }

    // The app-builder reports build failures with HTTP 200 and an `error`
    // field in the body (e.g. "package.json not found at ..."), so this must
    // be checked before looking for a URL.
    const upstreamError = this.extractError(body);
    if (upstreamError) {
      this.logger.warn(`App-builder deployment failed: ${upstreamError}`);
      throw new ServiceUnavailableException(`Deployment failed: ${upstreamError}`);
    }

    const url = this.extractUrl(body);
    if (!url) {
      this.logger.warn('App-builder deployment response did not include a URL');
      throw new ServiceUnavailableException('Deployment service returned an invalid response');
    }
    return { url };
  }

  private extractError(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null;
    const payload = body as { error?: unknown; data?: { error?: unknown } };
    const error = payload.error ?? payload.data?.error;
    return typeof error === 'string' && error.trim() ? error : null;
  }

  private extractUrl(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null;
    const payload = body as { url?: unknown; data?: { url?: unknown } };
    const url = payload.url ?? payload.data?.url;
    return typeof url === 'string' && url.trim() ? url : null;
  }
}
