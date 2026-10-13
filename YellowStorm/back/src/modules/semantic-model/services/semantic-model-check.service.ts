import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ModelCheck, ModelCheckIssue } from '../domain/semantic-model-check';
import { SemanticPopulationRefreshService } from './semantic-population-refresh.service';
import { SemanticRuntimeClientService, type RuntimeModelCheck } from './semantic-runtime-client.service';

const MAX_CACHED_MODELS = 500;
const MAX_CACHED_ANSWERS = 200;

/**
 * Live consistency check of a model: what a preview, build or publish of the draft would be refused or would skip,
 * checked while the model is edited. The back end's own rules run while the draft is planned (the same planning a
 * run uses, in check mode: nothing is listed, fetched or stored); the runtime then checks the plan it would receive
 * with the rules it runs on. Planning only reads the model's rows; the runtime answer is cached by what it covers
 * (specification, mappings, link rules, derived sources and limits), so an unchanged model costs no runtime call.
 */
@Injectable()
export class SemanticModelCheckService {
  private readonly checks = new Map<string, { key: string; check: ModelCheck }>();
  private readonly answers = new Map<string, RuntimeModelCheck>();
  private readonly pending = new Map<string, Promise<RuntimeModelCheck>>();

  constructor(
    private readonly refresh: SemanticPopulationRefreshService,
    private readonly runtime: SemanticRuntimeClientService,
  ) {}

  /** Anyone who may read the model may read its check. */
  async check(userId: string, modelId: string): Promise<ModelCheck> {
    const { model, issues, request } = await this.refresh.checkPlan(userId, modelId);
    const key = digest([model?.currentDraftVersionId ?? null, issues, request]);
    const known = this.checks.get(modelId);
    if (known?.key === key) return known.check;
    const found = [...issues];
    let cacheable = true;
    if (request) {
      try {
        found.push(...(await this.runtimeAnswer(digest(request), request)).issues);
      } catch (error) {
        // The runtime part is unknown, not fine: say so as a warning, and ask again next time.
        cacheable = false;
        found.push({
          severity: 'warning', code: 'runtime_unavailable', message: 'The runtime rules could not be checked right now',
          params: { detail: error instanceof Error ? error.constructor.name : 'Error' },
        });
      }
    }
    const sorted = [...found.filter((issue) => issue.severity === 'error'), ...found.filter((issue) => issue.severity !== 'error')];
    const check: ModelCheck = {
      modelId, versionKey: key.slice(0, 16), checkedAt: new Date().toISOString(),
      errorCount: sorted.filter((issue) => issue.severity === 'error').length,
      warningCount: sorted.filter((issue) => issue.severity !== 'error').length,
      issues: sorted,
    };
    if (cacheable) {
      this.checks.delete(modelId);
      this.checks.set(modelId, { key, check });
      while (this.checks.size > MAX_CACHED_MODELS) this.checks.delete(this.checks.keys().next().value!);
    }
    return check;
  }

  private async runtimeAnswer(key: string, request: NonNullable<Awaited<ReturnType<SemanticPopulationRefreshService['checkPlan']>>['request']>) {
    const cached = this.answers.get(key);
    if (cached) return cached;
    let call = this.pending.get(key);
    if (!call) {
      call = this.runtime.checkModelPlan(request).finally(() => this.pending.delete(key));
      this.pending.set(key, call);
    }
    const answer = await call;
    this.answers.set(key, answer);
    while (this.answers.size > MAX_CACHED_ANSWERS) this.answers.delete(this.answers.keys().next().value!);
    return answer;
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
