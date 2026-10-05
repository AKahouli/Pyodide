import { randomBytes } from 'crypto';
import { Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppDataDeploymentService } from '@modules/app-data/services/app-data-deployment.service';
import { RuntimeRevisionService } from '@modules/app-runtime/services/runtime-revision.service';
import {
  PlatformBaselineService,
  type BaselineFile,
} from '@modules/app-runtime/platform-kit/platform-baseline.service';
import { checkAiUsage } from '@modules/app-runtime/platform-kit/platform-conformance';
import { ModelsService } from '@modules/models/models.service';
import {
  detectRevisionUsesAi,
  isScannableAppSourcePath,
} from '../utils/conversation-v2-revision-ai-usage';

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
    private readonly baseline: PlatformBaselineService,
    private readonly modelsService: ModelsService,
    @Optional() private readonly appDataDeployment?: AppDataDeploymentService,
  ) {}

  async deploy(
    aiSessionId: string,
    revisionId: string,
    ownerUserId?: string,
  ): Promise<DeployResponse> {
    const startedAt = Date.now();
    this.logger.log(
      `[deploy] start session=${aiSessionId} revision=${revisionId} owner=${ownerUserId ?? 'none'}`,
    );

    const productionEnv: Record<string, string> = {
      VITE_APP_BASE: this.resolveDeployAppBasePath(aiSessionId),
    };

    // Re-verify the platform baseline the workspace was seeded with. Missing
    // files are re-added deterministically; a platform file the agent rewrote
    // into something that cannot run in production is refused.
    this.logger.log(
      `[deploy] platform baseline plan mode=deploy session=${aiSessionId} revision=${revisionId}`,
    );
    const baselinePlan = await this.baseline.planBaseline({
      workspaceId: aiSessionId,
      revisionId,
      mode: 'deploy',
    });
    this.logger.log(
      `[deploy] platform baseline result session=${aiSessionId} revision=${revisionId} ` +
        `files=${String(baselinePlan.files.length)} violations=${String(baselinePlan.violations.length)}` +
        (baselinePlan.violations.length
          ? ` detail=${baselinePlan.violations.join(' | ')}`
          : ''),
    );
    if (baselinePlan.violations.length) {
      throw new ServiceUnavailableException(
        `This app does not meet the YellowStorm platform contract. ${baselinePlan.violations.join(
          ' ',
        )} Fix it in OpenCode, finalize again, then deploy.`,
      );
    }

    const usesAi = await detectRevisionUsesAi(this.revisions, aiSessionId, revisionId);
    this.logger.log(
      `[deploy] AI usage scan session=${aiSessionId} revision=${revisionId} usesAi=${String(usesAi)}`,
    );
    const backendUrl = this.resolveDeployBackendUrl();
    if (backendUrl && usesAi) {
      productionEnv.VITE_YM_API_BASE_URL = `${backendUrl}/api/v1`;
      const defaultAiModelId = await this.resolveDeployDefaultAiModelId();
      if (defaultAiModelId) {
        productionEnv.VITE_YM_AI_DEFAULT_MODEL = defaultAiModelId;
      }
    }

    if (this.config.get<boolean>('appData.enabled', false) && this.appDataDeployment) {
      this.logger.log(`[deploy] App Data PROD merge session=${aiSessionId} revision=${revisionId}`);
      await this.mergeAppDataProductionEnv(aiSessionId, revisionId, ownerUserId, productionEnv);
    }
    if (usesAi) {
      this.logger.log(
        `[deploy] AI proxy enabled session=${aiSessionId} revision=${revisionId} ` +
          `apiBaseConfigured=${String(Boolean(productionEnv.VITE_YM_API_BASE_URL))}`,
      );
    }

    let deployRevisionId = revisionId;
    this.logger.log(
      `[deploy] assert production env keys=[${Object.keys(productionEnv).sort().join(',')}]`,
    );
    await this.assertProductionEnv(aiSessionId, revisionId, productionEnv, usesAi);
    try {
      deployRevisionId = await this.injectEnvProduction(
        aiSessionId,
        revisionId,
        productionEnv,
        baselinePlan.files,
      );
      this.logger.log(
        `[deploy] patched revision ready base=${revisionId} deployRevision=${deployRevisionId}`,
      );
    } catch (err) {
      this.logger.error(
        `[deploy] .env.production injection failed revision=${revisionId} error=${describeError(err)}`,
      );
      throw new ServiceUnavailableException('Failed to prepare deployment environment');
    }

    const runtime = this.getDeployRuntimeConfig();
    this.logger.log(
      `[deploy] launch app-builder baseUrl=${runtime.baseUrl} ` +
        `timeoutMs=${String(runtime.deployTimeoutMs)} pollMs=${String(runtime.statusPollIntervalMs)} ` +
        `tokenConfigured=${String(Boolean(runtime.token))} session=${aiSessionId} ` +
        `deployRevision=${deployRevisionId}`,
    );
    const deadline = Date.now() + runtime.deployTimeoutMs;
    const launchBody: Record<string, string> = {
      aiSessionId,
      revisionId: deployRevisionId,
      runtimeEnv: JSON.stringify(productionEnv),
    };
    const launch = await this.requestAppBuilder({
      baseUrl: runtime.baseUrl,
      path: 'app/deploy',
      token: runtime.token,
      body: launchBody,
      deadline,
    });
    const launchStatus = this.extractString(launch, 'status');
    const launchAppId = this.extractString(launch, 'app_id') ?? aiSessionId;
    this.logger.log(
      `[deploy] launch response session=${aiSessionId} appId=${launchAppId} status=${launchStatus ?? 'none'}`,
    );

    if (this.isReady(launchStatus)) {
      const ready = {
        ...this.extractDeployment(launch, launchAppId),
        runtimeEnv: productionEnv,
      };
      this.logger.log(
        `[deploy] ready immediately session=${aiSessionId} appId=${ready.appId} ` +
          `url=${ready.url} elapsedMs=${String(Date.now() - startedAt)}`,
      );
      return ready;
    }
    if (launchStatus !== 'deploying') {
      this.logger.warn(
        `[deploy] App-builder launch did not confirm deploying status=${launchStatus ?? 'none'}`,
      );
      throw new ServiceUnavailableException('Deployment service returned an invalid response');
    }

    this.logger.log(
      `[deploy] polling status session=${aiSessionId} appId=${launchAppId} ` +
        `initialDelayMs=${String(runtime.initialStatusDelayMs)}`,
    );
    await this.waitForNextPoll(runtime.initialStatusDelayMs, deadline);
    const polled = await this.pollUntilReady({
      baseUrl: runtime.baseUrl,
      token: runtime.token,
      aiSessionId,
      launchAppId,
      deadline,
      statusPollIntervalMs: runtime.statusPollIntervalMs,
      deployTimeoutMs: runtime.deployTimeoutMs,
      runtimeEnv: productionEnv,
    });
    this.logger.log(
      `[deploy] ready after poll session=${aiSessionId} appId=${polled.appId} ` +
        `url=${polled.url} elapsedMs=${String(Date.now() - startedAt)}`,
    );
    return polled;
  }

  /** Public URL path prefix for deployed apps, e.g. `/apps/{sessionId}/`. */
  resolveDeployAppBasePath(aiSessionId: string): string {
    const prefix =
      this.config.get<string>('conversationV2.appBuilderDeployedAppsPathPrefix')?.trim() ||
      '/apps';
    const normalized = prefix.replace(/\/$/, '');
    return `${normalized}/${aiSessionId}/`;
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
    let lastStatus: string | null = null;
    let pollCount = 0;
    while (Date.now() < deadline) {
      pollCount += 1;
      const remainingMs = deadline - Date.now();
      this.logger.log(
        `[deploy] status poll #${String(pollCount)} session=${aiSessionId} appId=${launchAppId} remainingMs=${String(remainingMs)}`,
      );
      const statusBody = await this.requestAppBuilder({
        baseUrl,
        path: 'app/deploy/status',
        token,
        body: { aiSessionId },
        deadline,
      });
      const status = this.extractString(statusBody, 'status');
      lastStatus = status;
      this.logger.log(
        `[deploy] status poll #${String(pollCount)} result session=${aiSessionId} status=${status ?? 'none'}`,
      );
      if (this.isReady(status)) {
        return { ...this.extractDeployment(statusBody, launchAppId), runtimeEnv: context.runtimeEnv };
      }
      if (status !== 'deploying') {
        this.logger.warn(
          `[deploy] App-builder returned unsupported deployment status: ${status ?? 'none'}`,
        );
        throw new ServiceUnavailableException('Deployment failed with an invalid status');
      }
      await this.waitForNextPoll(
        statusPollIntervalMs,
        deadline,
        `session=${aiSessionId} appId=${launchAppId} lastStatus=${lastStatus ?? 'none'}`,
      );
    }
    return this.throwTimeout(
      context.deployTimeoutMs,
      `session=${aiSessionId} appId=${launchAppId} lastStatus=${lastStatus ?? 'none'} polls=${String(pollCount)}`,
    );
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

    this.logger.log(
      `[deploy] POST ${endpoint.toString()} remainingMs=${String(remainingMs)} ` +
        `bodyKeys=[${Object.keys(body).sort().join(',')}]`,
    );
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(remainingMs),
      });
      const rawBody = await response.text();
      this.logger.log(
        `[deploy] App-builder ${path} response status=${String(response.status)} bodyChars=${String(rawBody.length)}`,
      );
      if (!response.ok) {
        this.logger.warn(
          `[deploy] App-builder ${path} failed status=${String(response.status)} bodyPreview=${rawBody.slice(0, 300)}`,
        );
        throw new ServiceUnavailableException('Deployment service rejected the request');
      }
      return this.parseResponse(rawBody);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      if (errorName(error) === 'TimeoutError') return this.throwTimeout();
      this.logger.error(
        `[deploy] App-builder ${path} request failed: ${describeError(error)}`,
      );
      throw new ServiceUnavailableException('Deployment service is unavailable');
    }
  }

  private parseResponse(rawBody: string): unknown {
    let body: unknown;
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      this.logger.warn('[deploy] App-builder returned malformed JSON');
      throw new ServiceUnavailableException('Deployment service returned an invalid response');
    }
    const upstreamError = this.extractString(body, 'error');
    if (upstreamError) {
      this.logger.warn(`[deploy] App-builder returned error upstreamError=${upstreamError}`);
      throw new ServiceUnavailableException(`Deployment failed: ${upstreamError}`);
    }
    return body;
  }

  private extractDeployment(body: unknown, fallbackAppId: string | null): DeployResponse {
    const appId = this.extractString(body, 'app_id') ?? fallbackAppId;
    const previewUrl = this.extractString(body, 'preview_url');
    const url = previewUrl ?? this.extractString(body, 'url');
    if (!appId || !url) {
      this.logger.warn('[deploy] App-builder ready response missing app_id or url');
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

  private async waitForNextPoll(
    delayMs: number,
    deadline: number,
    timeoutDetails?: string,
  ): Promise<void> {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return this.throwTimeout(undefined, timeoutDetails);
    await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, remainingMs)));
    if (Date.now() >= deadline) return this.throwTimeout(undefined, timeoutDetails);
  }

  private throwTimeout(deployTimeoutMs?: number, details?: string): never {
    const timeoutMs =
      deployTimeoutMs ?? this.config.get<number>('conversationV2.appBuilderDeployTimeoutMs') ?? 0;
    this.logger.error(
      `[deploy] App-builder deployment timed out timeoutMs=${String(timeoutMs)}${
        details ? ` detail=${details}` : ''
      }`,
    );
    throw new ServiceUnavailableException(
      details ? `Deployment service timed out (${details})` : 'Deployment service timed out',
    );
  }

  /**
   * Public API origin baked into deployed apps as VITE_YM_API_BASE_URL.
   * Loopback defaults are unreachable from apps.yellowsys.org browsers.
   * Prefer BACKEND_URL, then the existing public runtime base URL.
   */
  private resolveDeployBackendUrl(): string {
    const candidates = [
      this.config.get<string>('app.backendUrl'),
      this.config.get<string>('appRuntime.publicBaseUrl'),
    ];
    for (const candidate of candidates) {
      const url = candidate?.trim().replace(/\/$/, '');
      if (url && !this.isLoopbackUrl(url)) return url;
    }
    return '';
  }

  private isLoopbackUrl(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
    } catch {
      return false;
    }
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
    baselineFiles: BaselineFile[],
  ): Promise<string> {
    const lines = Object.entries(env)
      .map(([k, v]) => `${k}=${quoteDotenvValue(v)}`)
      .join('\n');

    const patchedRevisionId = `${baseRevisionId}_deploy_${randomBytes(4).toString('hex')}`;

    await this.revisions.patchRevisionWithFiles({
      workspaceId,
      baseRevisionId,
      newRevisionId: patchedRevisionId,
      additionalFiles: [
        ...baselineFiles,
        { path: '.env.production', content: lines + '\n' },
      ],
    });

    this.logger.log(
      `[deploy] .env.production injected revision=${patchedRevisionId} base=${baseRevisionId} ` +
        `platformFiles=${String(baselineFiles.length)} envKeys=[${Object.keys(env)
          .sort()
          .join(',')}]`,
    );
    return patchedRevisionId;
  }

  /**
   * Deployed apps always enforce App Data auth, so App Data is provisioned
   * systematically — there is no "app without auth" path.
   */
  private async mergeAppDataProductionEnv(
    aiSessionId: string,
    revisionId: string,
    ownerUserId: string | undefined,
    productionEnv: Record<string, string>,
  ): Promise<void> {
    if (ownerUserId) {
      try {
        await this.appDataDeployment!.ensureDevProvisioned(aiSessionId, ownerUserId);
      } catch (err) {
        this.logger.error(
          `[deploy] App Data DEV ensure failed session=${aiSessionId} error=${describeError(err)}`,
        );
        throw new ServiceUnavailableException(
          'App Data could not be provisioned for this workspace. Check App Data service connectivity, then deploy again.',
        );
      }
    }

    try {
      const env = await this.appDataDeployment!.prepareProduction(aiSessionId, revisionId);
      Object.assign(productionEnv, {
        VITE_YM_APP_DATA_URL: env.publicUrl,
        VITE_YM_APP_DATA_ID: env.appDataId,
        VITE_YM_APP_DATA_ENV: env.environment,
      });
      this.logger.log(
        `[deploy] App Data PROD env prepared session=${aiSessionId} url=${env.publicUrl} appDataId=${env.appDataId}`,
      );
    } catch (err) {
      this.logger.error(
        `[deploy] App Data prepareProduction failed session=${aiSessionId} revision=${revisionId} error=${describeError(err)}`,
      );
      throw new ServiceUnavailableException(
        'App Data could not be prepared for production. Provision App Data (OpenCode MCP yellowappdata_provision or deploy with owner context), then deploy again.',
      );
    }
  }

  /**
   * Catalog model id baked into deployed apps as VITE_YM_AI_DEFAULT_MODEL.
   * Prefer conversation-v2 admin default, then platform default — same order as
   * BrowserRuntimeHost preview injection when no composer selection is stored.
   */
  private async resolveDeployDefaultAiModelId(): Promise<string | null> {
    try {
      const conversationV2Default = await this.modelsService.getConversationV2DefaultModel();
      if (conversationV2Default?.id) return conversationV2Default.id;
      const platformDefault = await this.modelsService.getDefaultModel();
      return platformDefault?.id ?? null;
    } catch (err) {
      this.logger.warn(
        `[deploy] default AI model lookup failed: ${describeError(err)}`,
      );
      return null;
    }
  }

  /**
   * The baseline guarantees the app's structure; this guarantees the values it
   * will read at runtime actually exist.
   */
  private async assertProductionEnv(
    workspaceId: string,
    revisionId: string,
    runtimeEnv: Record<string, string>,
    usesAi: boolean,
  ): Promise<void> {
    if (this.config.get<boolean>('appData.enabled', false)) {
      if (!runtimeEnv.VITE_YM_APP_DATA_URL || !runtimeEnv.VITE_YM_APP_DATA_ID) {
        throw new ServiceUnavailableException(
          'App Data production env vars are missing after prepareProduction. Provision App Data for this workspace, then deploy again.',
        );
      }
    }

    if (!usesAi) return;

    if (!runtimeEnv.VITE_YM_API_BASE_URL) {
      throw new ServiceUnavailableException(
        'This app calls the AI proxy but no browser-reachable YellowStorm API origin is configured. Set BACKEND_URL or APP_RUNTIME_PUBLIC_BASE_URL to a public origin (not localhost), then deploy again.',
      );
    }

    const { files } = await this.revisions.listFiles(workspaceId, revisionId);
    const candidates = files
      .map((file) => file.path)
      .filter(isScannableAppSourcePath)
      .slice(0, 40);
    for (const path of candidates) {
      const source = await this.revisions.readRevisionFileText(workspaceId, revisionId, path);
      const violations = checkAiUsage(source ?? '');
      if (violations.length) {
        throw new ServiceUnavailableException(
          `AI integration does not meet the YellowStorm platform contract. ${path}: ${violations.join(
            ' ',
          )} Fix it in OpenCode, finalize again, then deploy.`,
        );
      }
    }
  }
}

function quoteDotenvValue(value: string): string {
  if (/^[A-Za-z0-9_./:-]*$/.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/** Anything can be thrown or rejected, so fall back to its string form. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorName(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'name' in error
    ? String(error.name)
    : undefined;
}
