import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface DeployResponse {
  appId: string;
  url: string;
}

interface AppBuilderPayload {
  status?: unknown;
  app_id?: unknown;
  url?: unknown;
  error?: unknown;
  data?: AppBuilderPayload;
}

interface DeploymentContext {
  baseUrl: string;
  token: string;
  conversationId: string;
  launchAppId: string;
  deadline: number;
  initialStatusDelayMs: number;
  statusPollIntervalMs: number;
  deployTimeoutMs: number;
}

interface AppBuilderRequest {
  baseUrl: string;
  path: 'app/deploy' | 'app/status';
  token: string;
  body: Record<string, string>;
  deadline: number;
}

interface DeployRuntimeConfig {
  baseUrl: string;
  token: string;
  deployTimeoutMs: number;
  initialStatusDelayMs: number;
  statusPollIntervalMs: number;
}

/**
 * Deploys a conversation application through the configured app-builder service.
 */
@Injectable()
export class ConversationV2DeployService {
  private readonly logger = new Logger(ConversationV2DeployService.name);

  constructor(private readonly config: ConfigService) {}

  async deploy(userId: string, conversationId: string): Promise<DeployResponse> {
    const runtime = this.getDeployRuntimeConfig();
    const deadline = Date.now() + runtime.deployTimeoutMs;
    const launch = await this.requestAppBuilder({
      baseUrl: runtime.baseUrl,
      path: 'app/deploy',
      token: runtime.token,
      body: { user_id: userId, conversation_id: conversationId },
      deadline,
    });
    const launchStatus = this.extractString(launch, 'status');
    const launchAppId = this.extractString(launch, 'app_id');

    if (launchStatus === 'deployed') {
      return this.extractDeployment(launch, launchAppId);
    }
    if (launchStatus !== 'deploying' || !launchAppId) {
      this.logger.warn('App-builder deploy response did not confirm a deploying app');
      throw new ServiceUnavailableException('Deployment service returned an invalid response');
    }

    await this.waitForNextPoll(runtime.initialStatusDelayMs, deadline);
    return this.pollUntilDeployed({
      baseUrl: runtime.baseUrl,
      token: runtime.token,
      conversationId,
      launchAppId,
      deadline,
      initialStatusDelayMs: runtime.initialStatusDelayMs,
      statusPollIntervalMs: runtime.statusPollIntervalMs,
      deployTimeoutMs: runtime.deployTimeoutMs,
    });
  }

  private getDeployRuntimeConfig(): DeployRuntimeConfig {
    const baseUrl = this.config.get<string>('conversationV2.appBuilderDeployBaseUrl')?.trim();
    const token = this.config.get<string>('conversationV2.appBuilderDeployToken')?.trim();
    if (!baseUrl || !token) {
      throw new ServiceUnavailableException(
        'Deployment service is not configured (APP_BUILDER_DEPLOY_BASE_URL / APP_BUILDER_DEPLOY_TOKEN)',
      );
    }
    return {
      baseUrl,
      token,
      deployTimeoutMs: this.config.get<number>('conversationV2.appBuilderDeployTimeoutMs')!,
      initialStatusDelayMs: this.config.get<number>(
        'conversationV2.appBuilderDeployInitialStatusDelayMs',
      )!,
      statusPollIntervalMs: this.config.get<number>(
        'conversationV2.appBuilderDeployStatusPollIntervalMs',
      )!,
    };
  }

  private async pollUntilDeployed(context: DeploymentContext): Promise<DeployResponse> {
    const { baseUrl, token, conversationId, launchAppId, deadline, statusPollIntervalMs } =
      context;
    while (Date.now() < deadline) {
      const statusBody = await this.requestAppBuilder({
        baseUrl,
        path: 'app/status',
        token,
        body: { conversation_id: conversationId },
        deadline,
      });
      const status = this.extractString(statusBody, 'status');
      if (status === 'deployed') return this.extractDeployment(statusBody, launchAppId);
      if (status !== 'deploying') {
        this.logger.warn(`App-builder returned unsupported deployment status: ${status ?? 'none'}`);
        throw new ServiceUnavailableException('Deployment failed with an invalid status');
      }
      await this.waitForNextPoll(statusPollIntervalMs, deadline);
    }
    return this.throwTimeout(context.deployTimeoutMs);
  }

  private async requestAppBuilder(request: AppBuilderRequest): Promise<unknown> {
    const { baseUrl, path, token, body, deadline } = request;
    const endpoint = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return this.throwTimeout();

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(remainingMs),
      });
      const rawBody = await response.text();
      this.logger.log(
        `App-builder ${path} response: status=${response.status} headers=${JSON.stringify(
          Object.fromEntries(response.headers.entries()),
        )} body=${rawBody}`,
      );
      if (!response.ok) {
        this.logger.warn(`App-builder ${path} failed with status ${response.status}`);
        throw new ServiceUnavailableException('Deployment service rejected the request');
      }
      return this.parseResponse(rawBody);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      if ((error as Error).name === 'TimeoutError') return this.throwTimeout();
      this.logger.error(`App-builder ${path} request failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException('Deployment service is unavailable');
    }
  }

  private parseResponse(rawBody: string): unknown {
    let body: unknown;
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      this.logger.warn('App-builder returned malformed JSON');
      throw new ServiceUnavailableException('Deployment service returned an invalid response');
    }
    const upstreamError = this.extractString(body, 'error');
    if (upstreamError) {
      this.logger.warn(`App-builder deployment failed: ${upstreamError}`);
      throw new ServiceUnavailableException(`Deployment failed: ${upstreamError}`);
    }
    return body;
  }

  private extractDeployment(body: unknown, fallbackAppId: string | null): DeployResponse {
    const appId = this.extractString(body, 'app_id') ?? fallbackAppId;
    const url = this.extractString(body, 'url');
    if (!appId || !url) {
      this.logger.warn('App-builder deployed response did not include app_id and url');
      throw new ServiceUnavailableException('Deployment service returned an invalid response');
    }
    return { appId, url };
  }

  private extractString(body: unknown, field: keyof AppBuilderPayload): string | null {
    if (!body || typeof body !== 'object') return null;
    const payload = body as AppBuilderPayload;
    const value = payload[field] ?? payload.data?.[field];
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private async waitForNextPoll(delayMs: number, deadline: number): Promise<void> {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return this.throwTimeout();
    await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, remainingMs)));
    if (Date.now() >= deadline) return this.throwTimeout();
  }

  private throwTimeout(deployTimeoutMs?: number): never {
    const timeoutMs =
      deployTimeoutMs ?? this.config.get<number>('conversationV2.appBuilderDeployTimeoutMs') ?? 0;
    this.logger.error(`App-builder deployment timed out after ${timeoutMs / 1000}s`);
    throw new ServiceUnavailableException('Deployment service timed out');
  }
}
