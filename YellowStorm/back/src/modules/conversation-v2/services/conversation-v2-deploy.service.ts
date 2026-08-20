import { randomBytes } from 'crypto';
import { Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppDataDeploymentService } from '@modules/app-data/services/app-data-deployment.service';
import { RuntimeRevisionService } from '@modules/app-runtime/services/runtime-revision.service';
import {
  AppDataErrorCode,
  AppDataException,
} from '@modules/app-data/constants/app-data.errors';

const DEFAULT_DEPLOY_BASE_URL = 'https://app-deployer.yellowsys.org/';

interface DeployResponse {
  appId: string;
  url: string;
  revisionId?: string;
  runtimeEnv?: Record<string, string>;
}

interface AppBuilderPayload {
  status?: unknown;
  app_id?: unknown;
  revision_id?: unknown;
  url?: unknown;
  preview_url?: unknown;
  error?: unknown;
  data?: AppBuilderPayload;
}

interface DeploymentContext {
  baseUrl: string;
  token: string | undefined;
  aiSessionId: string;
  launchAppId: string;
  deadline: number;
  statusPollIntervalMs: number;
  deployTimeoutMs: number;
  runtimeEnv?: Record<string, string>;
}

interface AppBuilderRequest {
  baseUrl: string;
  path: 'app/deploy' | 'app/deploy/status';
  token: string | undefined;
  body: Record<string, string>;
  deadline: number;
}

interface DeployRuntimeConfig {
  baseUrl: string;
  token: string | undefined;
  deployTimeoutMs: number;
  initialStatusDelayMs: number;
  statusPollIntervalMs: number;
}

/**
 * Deploys a finalized App Builder revision through app-deployer.yellowsys.org.
 */
@Injectable()
export class ConversationV2DeployService {
  private readonly logger = new Logger(ConversationV2DeployService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly revisions: RuntimeRevisionService,
    @Optional() private readonly appDataDeployment?: AppDataDeploymentService,
  ) {}

  async deploy(aiSessionId: string, revisionId: string): Promise<DeployResponse> {
    let runtimeEnv: Record<string, string> | undefined;
    if (this.config.get<boolean>('appData.enabled', false) && this.appDataDeployment) {
      try {
        const env = await this.appDataDeployment.prepareProduction(aiSessionId, revisionId);
        runtimeEnv = {
          VITE_YM_APP_DATA_URL: env.publicUrl,
          VITE_YM_APP_DATA_ID: env.appDataId,
          VITE_YM_APP_DATA_ENV: env.environment,
        };
        this.logger.log(
          `App Data PROD env prepared for session=${aiSessionId}: URL=${env.publicUrl} appDataId=${env.appDataId}`,
        );
      } catch (err) {
        if (
          err instanceof AppDataException &&
          err.appDataCode === AppDataErrorCode.NOT_PROVISIONED
        ) {
          this.logger.warn(
            `App Data NOT_PROVISIONED for session=${aiSessionId} rev=${revisionId} — deploying without App Data env vars`,
          );
        } else if (await this.appDataDeployment.getRuntimeEnvForWorkspace(aiSessionId, 'dev')) {
          throw err;
        } else {
          this.logger.warn(
            `App Data prepareProduction failed for session=${aiSessionId} — deploying without App Data env vars: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }

    let deployRevisionId = revisionId;
    if (runtimeEnv) {
      try {
        deployRevisionId = await this.injectEnvProduction(aiSessionId, revisionId, runtimeEnv);
      } catch (err) {
        this.logger.warn(
          `Failed to inject .env.production into revision ${revisionId} — deploying without it: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const runtime = this.getDeployRuntimeConfig();
    const deadline = Date.now() + runtime.deployTimeoutMs;
    const launchBody: Record<string, string> = { aiSessionId, revisionId: deployRevisionId };
    if (runtimeEnv) {
      launchBody.runtimeEnv = JSON.stringify(runtimeEnv);
    }
    const launch = await this.requestAppBuilder({
      baseUrl: runtime.baseUrl,
      path: 'app/deploy',
      token: runtime.token,
      body: launchBody,
      deadline,
    });
    const launchStatus = this.extractString(launch, 'status');
    const launchAppId = this.extractString(launch, 'app_id') ?? aiSessionId;

    if (this.isReady(launchStatus)) {
      return { ...this.extractDeployment(launch, launchAppId), runtimeEnv };
    }
    if (launchStatus !== 'deploying') {
      this.logger.warn('App-builder deploy response did not confirm a deploying app');
      throw new ServiceUnavailableException('Deployment service returned an invalid response');
    }

    await this.waitForNextPoll(runtime.initialStatusDelayMs, deadline);
    return this.pollUntilReady({
      baseUrl: runtime.baseUrl,
      token: runtime.token,
      aiSessionId,
      launchAppId,
      deadline,
      statusPollIntervalMs: runtime.statusPollIntervalMs,
      deployTimeoutMs: runtime.deployTimeoutMs,
      runtimeEnv,
    });
  }

  private getDeployRuntimeConfig(): DeployRuntimeConfig {
    const baseUrl =
      this.config.get<string>('conversationV2.appBuilderDeployBaseUrl')?.trim() ||
      DEFAULT_DEPLOY_BASE_URL;
    const token = this.config.get<string>('conversationV2.appBuilderDeployToken')?.trim();
    return {
      baseUrl,
      token: token || undefined,
      deployTimeoutMs: this.config.get<number>('conversationV2.appBuilderDeployTimeoutMs')!,
      initialStatusDelayMs: this.config.get<number>(
        'conversationV2.appBuilderDeployInitialStatusDelayMs',
      )!,
      statusPollIntervalMs: this.config.get<number>(
        'conversationV2.appBuilderDeployStatusPollIntervalMs',
      )!,
    };
  }

  private async pollUntilReady(context: DeploymentContext): Promise<DeployResponse> {
    const { baseUrl, token, aiSessionId, launchAppId, deadline, statusPollIntervalMs } =
      context;
    while (Date.now() < deadline) {
      const statusBody = await this.requestAppBuilder({
        baseUrl,
        path: 'app/deploy/status',
        token,
        body: { aiSessionId },
        deadline,
      });
      const status = this.extractString(statusBody, 'status');
      if (this.isReady(status)) {
        return { ...this.extractDeployment(statusBody, launchAppId), runtimeEnv: context.runtimeEnv };
      }
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

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
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
    const previewUrl = this.extractString(body, 'preview_url');
    const url = previewUrl ?? this.extractString(body, 'url');
    if (!appId || !url) {
      this.logger.warn('App-builder ready response did not include app_id and url');
      throw new ServiceUnavailableException('Deployment service returned an invalid response');
    }
    return {
      appId,
      url,
      revisionId: this.extractString(body, 'revision_id') ?? undefined,
    };
  }

  private isReady(status: string | null): boolean {
    return status === 'ready' || status === 'deployed';
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

  /**
   * Create a patched revision that includes a `.env.production` file with
   * the PROD VITE env vars. The app-deployer runs `vite build` which reads
   * `.env.production` automatically — no deployer-side changes needed.
   */
  private async injectEnvProduction(
    workspaceId: string,
    baseRevisionId: string,
    env: Record<string, string>,
  ): Promise<string> {
    const lines = Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const patchedRevisionId = `${baseRevisionId}_deploy_${randomBytes(4).toString('hex')}`;

    await this.revisions.patchRevisionWithFiles({
      workspaceId,
      baseRevisionId,
      newRevisionId: patchedRevisionId,
      additionalFiles: [{ path: '.env.production', content: lines + '\n' }],
    });

    this.logger.log(
      `Injected .env.production into patched revision ${patchedRevisionId} (base ${baseRevisionId})`,
    );
    return patchedRevisionId;
  }
}
