import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BadRequestException, ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import {
  SemanticModelBuildApplyMode,
  SemanticModelBuildJob,
  SemanticModelBuildStartRequest,
  SemanticModelBuildStartResponse,
  SemanticModelBuildStatus,
  SemanticModelBuildStep,
  SemanticModelBuildStepStatus,
} from '../domain/semantic-model-build.types';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticModelMappingProposalService } from './semantic-model-mapping-proposal.service';
import { SemanticModelOntologyGenerationService } from './semantic-model-ontology-generation.service';
import { SemanticModelService } from './semantic-model.service';

/**
 * Orchestrates the 3-step "Construire le graphe" pipeline as an async background job.
 *
 * Fire-and-forget: `startAsync` returns a buildId immediately, then the pipeline runs
 * in the background (`void this.run(...)`). The UI polls `getBuild` / `getLatestBuild`.
 *
 * No global timeout — legitimate work (LLM extraction, native search across many docs)
 * can take a very long time. A heartbeat proves the process is alive; if the heartbeat
 * stops firing for more than the TTL, the job is considered a zombie (dead process)
 * and marked failed. The TTL is generous (5 min = 10× heartbeat interval) so a slow
 * GC or DB hiccup never kills a real job.
 */
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TTL_MS = 300_000;

interface BuildRow {
  id: string;
  model_id: string;
  started_by: string;
  status: SemanticModelBuildStatus;
  current_step: SemanticModelBuildStep | null;
  ontology_status: SemanticModelBuildStepStatus;
  mapping_status: SemanticModelBuildStepStatus;
  apply_status: SemanticModelBuildStepStatus;
  apply_mode: SemanticModelBuildApplyMode;
  mapping_job_id: string | null;
  graph_warning: string | null;
  error: string | null;
  started_at: string;
  ontology_completed_at: string | null;
  mapping_completed_at: string | null;
  apply_completed_at: string | null;
  completed_at: string | null;
  last_heartbeat_at: string;
}

@Injectable()
export class SemanticModelBuildOrchestratorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SemanticModelBuildOrchestratorService.name);
  private readonly heartbeatTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly db: SemanticModelDatabaseService,
    private readonly models: SemanticModelService,
    private readonly ontology: SemanticModelOntologyGenerationService,
    private readonly mappingProposals: SemanticModelMappingProposalService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Recovery pass: any 'running' row whose heartbeat expired before this boot
    // is a zombie left over from a crashed / restarted process. Mark failed so
    // the unique-index (one running build per model) does not block new launches.
    if (!this.db.isEnabled()) return;
    try {
      const result = await this.db.query(
        `UPDATE semantic_model.build_runs
           SET status = 'failed',
               error = COALESCE(error, 'server_restarted'),
               completed_at = now()
         WHERE status = 'running'
           AND last_heartbeat_at < now() - ($1::int || ' milliseconds')::interval
         RETURNING id`,
        [HEARTBEAT_TTL_MS],
      );
      if (result.rowCount && result.rowCount > 0) {
        this.logger.warn(`Recovered ${result.rowCount} zombie build_runs at boot`);
      }
    } catch (error) {
      this.logger.error('Zombie recovery pass failed', error instanceof Error ? error.stack : undefined);
    }
  }

  onModuleDestroy(): void {
    for (const buildId of this.heartbeatTimers.keys()) {
      this.stopHeartbeat(buildId);
    }
  }

  async startAsync(
    userId: string,
    modelId: string,
    request: SemanticModelBuildStartRequest,
  ): Promise<SemanticModelBuildStartResponse> {
    await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);

    // Sweep zombies for THIS model before insert so the unique index does not
    // reject a legit new launch after a crash.
    await this.sweepZombies(modelId);

    const insert = await this.db.query<{ id: string }>(
      `INSERT INTO semantic_model.build_runs
         (model_id, started_by, business_requirements, apply_mode, status, ontology_status, current_step, last_heartbeat_at)
       VALUES ($1, $2, $3::jsonb, $4, 'running', 'running', 'ontology', now())
       RETURNING id`,
      [modelId, userId, JSON.stringify(request.businessRequirements), request.applyMode],
    ).catch((error: unknown) => {
      if (this.isUniqueViolation(error)) {
        throw new BadRequestException(
          ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
          'A build is already running for this model. Wait for it to finish or fail before starting a new one.',
        );
      }
      throw error;
    });

    const buildId = insert.rows[0].id;
    this.startHeartbeat(buildId);
    void this.run(userId, modelId, buildId, request).catch((error: unknown) => {
      this.logger.error(`Unexpected build orchestration error for ${buildId}`, error instanceof Error ? error.stack : String(error));
    });

    return { buildId, status: 'running' };
  }

  async getBuild(userId: string, modelId: string, buildId: string): Promise<SemanticModelBuildJob> {
    await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    await this.sweepZombies(modelId);
    const result = await this.db.query<BuildRow>(
      `SELECT * FROM semantic_model.build_runs WHERE id = $1 AND model_id = $2`,
      [buildId, modelId],
    );
    if (!result.rows.length) {
      throw new NotFoundException(`Build ${buildId} not found`);
    }
    return this.toJob(result.rows[0]);
  }

  async getLatestBuild(userId: string, modelId: string): Promise<SemanticModelBuildJob | null> {
    await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    await this.sweepZombies(modelId);
    const result = await this.db.query<BuildRow>(
      `SELECT * FROM semantic_model.build_runs
         WHERE model_id = $1
         ORDER BY started_at DESC
         LIMIT 1`,
      [modelId],
    );
    return result.rows.length ? this.toJob(result.rows[0]) : null;
  }

  // ── orchestration ──────────────────────────────────────────────────────────

  private async run(
    userId: string,
    modelId: string,
    buildId: string,
    request: SemanticModelBuildStartRequest,
  ): Promise<void> {
    try {
      // Step 1 — ontology
      await this.ontology.generate(userId, modelId, { businessRequirements: request.businessRequirements });
      await this.markStepDone(buildId, 'ontology', 'mapping');

      // Step 2 — mapping
      const mappingJob = await this.mappingProposals.startAsync(userId, modelId);
      await this.db.query(
        `UPDATE semantic_model.build_runs SET mapping_job_id = $1 WHERE id = $2`,
        [mappingJob.jobId, buildId],
      );
      const completed = await this.awaitMappingCompletion(userId, modelId, mappingJob.jobId, buildId);
      await this.markStepDone(buildId, 'mapping', 'apply');

      // Step 3 — apply
      const applyResult = await this.mappingProposals.applyMappingPlan(userId, modelId, completed, request.applyMode);
      await this.db.query(
        `UPDATE semantic_model.build_runs
           SET status = 'completed',
               current_step = NULL,
               apply_status = 'completed',
               apply_completed_at = now(),
               completed_at = now(),
               graph_warning = $1
         WHERE id = $2`,
        [applyResult.graphViewerWarning, buildId],
      );
      this.logger.log(`Build ${buildId} completed for model ${modelId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Build ${buildId} failed for model ${modelId}: ${message}`);
      await this.db.query(
        `UPDATE semantic_model.build_runs
           SET status = 'failed',
               error = $1,
               completed_at = now(),
               ontology_status = CASE WHEN ontology_status = 'running' THEN 'failed' ELSE ontology_status END,
               mapping_status  = CASE WHEN mapping_status  = 'running' THEN 'failed' ELSE mapping_status  END,
               apply_status    = CASE WHEN apply_status    = 'running' THEN 'failed' ELSE apply_status    END
         WHERE id = $2`,
        [message.slice(0, 2000), buildId],
      ).catch((updateError: unknown) => {
        this.logger.error(`Failed to persist build failure for ${buildId}`, updateError instanceof Error ? updateError.stack : String(updateError));
      });
    } finally {
      this.stopHeartbeat(buildId);
    }
  }

  private async awaitMappingCompletion(
    userId: string,
    modelId: string,
    mappingJobId: string,
    buildId: string,
  ): Promise<string> {
    // Poll the mapping job every 3 seconds. No timeout: the outer build job is
    // itself timeout-free by design. This inner loop is only about waiting for
    // the async mapping job to reach a terminal state.
    while (true) {
      const job = await this.mappingProposals.getJob(userId, modelId, mappingJobId);
      if (job.status === 'completed') return mappingJobId;
      if (job.status === 'failed') {
        throw new ServiceUnavailableException(
          ErrorCode.SERVICE_UNAVAILABLE,
          `Mapping job failed: ${job.error ?? 'unknown error'}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      // Refresh heartbeat between polls so a very long mapping stays healthy.
      await this.refresh(buildId).catch(() => undefined);
    }
  }

  private async markStepDone(
    buildId: string,
    finishedStep: SemanticModelBuildStep,
    nextStep: SemanticModelBuildStep | null,
  ): Promise<void> {
    const column = `${finishedStep}_status`;
    const completedAtColumn = `${finishedStep}_completed_at`;
    const nextColumn = nextStep ? `${nextStep}_status` : null;

    if (nextColumn) {
      await this.db.query(
        `UPDATE semantic_model.build_runs
           SET ${column} = 'completed',
               ${completedAtColumn} = now(),
               ${nextColumn} = 'running',
               current_step = $1
         WHERE id = $2`,
        [nextStep, buildId],
      );
    } else {
      await this.db.query(
        `UPDATE semantic_model.build_runs
           SET ${column} = 'completed',
               ${completedAtColumn} = now(),
               current_step = NULL
         WHERE id = $1`,
        [buildId],
      );
    }
  }

  // ── heartbeat ──────────────────────────────────────────────────────────────

  private startHeartbeat(buildId: string): void {
    this.stopHeartbeat(buildId);
    const timer = setInterval(() => {
      void this.refresh(buildId).catch((error: unknown) => {
        this.logger.warn(`Heartbeat refresh failed for build ${buildId}`, error instanceof Error ? error.message : String(error));
      });
    }, HEARTBEAT_INTERVAL_MS);
    timer.unref?.();
    this.heartbeatTimers.set(buildId, timer);
  }

  private stopHeartbeat(buildId: string): void {
    const timer = this.heartbeatTimers.get(buildId);
    if (!timer) return;
    clearInterval(timer);
    this.heartbeatTimers.delete(buildId);
  }

  private async refresh(buildId: string): Promise<void> {
    await this.db.query(
      `UPDATE semantic_model.build_runs SET last_heartbeat_at = now() WHERE id = $1 AND status = 'running'`,
      [buildId],
    );
  }

  private async sweepZombies(modelId: string): Promise<void> {
    if (!this.db.isEnabled()) return;
    await this.db.query(
      `UPDATE semantic_model.build_runs
         SET status = 'failed',
             error = COALESCE(error, 'heartbeat_lost'),
             completed_at = now()
       WHERE model_id = $1
         AND status = 'running'
         AND last_heartbeat_at < now() - ($2::int || ' milliseconds')::interval`,
      [modelId, HEARTBEAT_TTL_MS],
    ).catch((error: unknown) => {
      this.logger.warn(`Zombie sweep failed for model ${modelId}`, error instanceof Error ? error.message : String(error));
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private toJob(row: BuildRow): SemanticModelBuildJob {
    return {
      buildId: row.id,
      modelId: row.model_id,
      startedBy: row.started_by,
      status: row.status,
      currentStep: row.current_step,
      ontologyStatus: row.ontology_status,
      mappingStatus: row.mapping_status,
      applyStatus: row.apply_status,
      applyMode: row.apply_mode,
      mappingJobId: row.mapping_job_id,
      graphWarning: row.graph_warning,
      error: row.error,
      startedAt: row.started_at,
      ontologyCompletedAt: row.ontology_completed_at,
      mappingCompletedAt: row.mapping_completed_at,
      applyCompletedAt: row.apply_completed_at,
      completedAt: row.completed_at,
      lastHeartbeatAt: row.last_heartbeat_at,
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505';
  }
}
