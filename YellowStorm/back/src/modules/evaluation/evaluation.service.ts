import { Injectable,  Logger,  NotFoundException,  ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import axios from 'axios';
import { AgentService } from '../agent/agent.service';
import { BadRequestException } from '../exceptions/exceptions/http.exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import type { DatasetItem, DatasetRecord, EvaluationRecord, EvaluationRunMode } from './evaluation.types';
import { PgEvaluationRunStore } from './persistence/pg-evaluation-run.store';
import { PgEvaluationDatasetStore } from './persistence/pg-evaluation-dataset.store';

@Injectable()
export class EvaluationService {
    private readonly logger = new Logger(EvaluationService.name);
    private readonly adkUrl: string;
    private readonly adkApiKey: string;

    constructor(
        private readonly evaluations: PgEvaluationRunStore,
        private readonly datasets: PgEvaluationDatasetStore,
        private readonly agentService: AgentService,
        private readonly configService: ConfigService,
    ) {
        this.adkUrl = this.configService.get<string>('indexing.apiAdk') || 'http://localhost:8000';
        this.adkApiKey = this.configService.get<string>('indexing.adkApiKey') || '';
    }

    // ==========================================
    // Dataset Methods
    // ==========================================

    async createDataset(userId: string, name: string, items: unknown[]): Promise<DatasetRecord> {
        const cleanName = typeof name === 'string' ? name.trim() : '';
        if (!cleanName) throw new BadRequestException('Dataset name is required');
        return this.datasets.create({
            name: cleanName,
            items: this.normalizeDatasetItems(items),
            createdBy: userId,
        });
    }

    async findAllDatasets(userId: string): Promise<DatasetRecord[]> {
        return this.datasets.findByCreator(userId);
    }

    async findDatasetById(id: string): Promise<DatasetRecord> {
        if (!id || id === 'undefined' || id === '') {
            throw new NotFoundException('Dataset ID is missing or invalid');
        }
        const dataset = await this.datasets.findById(id);
        if (!dataset) throw new NotFoundException(ErrorCode.NOT_FOUND);
        return dataset;
    }

    async deleteDataset(id: string): Promise<void> {
        await this.datasets.deleteById(id);
    }

    /** A dataset item needs both a question and a reference answer (the former Mongoose `required` + `trim`). */
    private normalizeDatasetItems(items: unknown): DatasetItem[] {
        if (items == null) return [];
        if (!Array.isArray(items)) throw new BadRequestException('Dataset items must be an array');
        return items.map((raw: unknown, index) => {
            const item = (raw ?? {}) as Record<string, unknown>;
            const question = typeof item.question === 'string' ? item.question.trim() : '';
            const referenceAnswer = typeof item.reference_answer === 'string' ? item.reference_answer.trim() : '';
            if (!question || !referenceAnswer) {
                throw new BadRequestException(`Dataset item ${String(index + 1)} needs a question and a reference_answer`);
            }
            return { question, reference_answer: referenceAnswer };
        });
    }

    /** Mongoose defaulted a missing mode to non_strict and rejected anything but the two values. */
    private parseMode(mode: string | null | undefined): EvaluationRunMode {
        if (mode === undefined || mode === null || mode === '') return 'non_strict';
        if (mode === 'strict' || mode === 'non_strict') return mode;
        throw new BadRequestException(`Invalid evaluation mode "${mode}"`);
    }

    // ==========================================
    // Evaluation Methods
    // ==========================================

    /**
     * Creates an evaluation record in DB and returns it.
     * The frontend orchestrates the individual runs.
     */
    async launchEvaluation(
        userId: string,
        permissions: string[],
        agentId: string,
        datasetId: string,
        numRuns: number,
        mode: string,
        scenarioName: string,
    ): Promise<EvaluationRecord> {
        const cleanScenarioName = typeof scenarioName === 'string' ? scenarioName.trim() : '';
        if (!cleanScenarioName) throw new BadRequestException('Scenario name is required');
        const runMode = this.parseMode(mode);

        await this.assertCanManageAgent(userId, permissions, agentId);

        await this.findDatasetById(datasetId);

        return this.evaluations.create({
            agentId,
            scenarioName: cleanScenarioName,
            datasetId,
            mode: runMode,
            createdBy: userId,
            numRuns: Math.max(1, Math.trunc(Number(numRuns)) || 1),
        });
    }

    /**
     * Runs a single evaluation run against the ADK.
     * Waits for the ADK to finish and returns the results.
     */
    async runSingleEvaluation(
        userId: string,
        permissions: string[],
        agentId: string,
        datasetId: string,
        mode: string,
        scenarioName: string,
        evaluationId: string,
        runIndex: number,
        authHeader: string,
        judgeModel?: string,
        threshold?: number,
    ): Promise<{ results: any[]; runIndex: number }> {
        const agent = await this.assertCanManageAgent(userId, permissions, agentId);
        const evaluation = await this.findEvaluationById(evaluationId);
        if (evaluation.agentId !== agentId.toLowerCase()) {
            throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_FORBIDDEN);
        }

        const agentConfig = await this.agentService.buildAgentsForStream(userId, undefined, [agentId]);
        const dataset = await this.findDatasetById(datasetId);

        // authHeader is no longer forwarded to ADK — service-to-service auth uses x-api-key.
        void authHeader;

        const selectedJudgeModel = (() => {
            const jm = (judgeModel || '').trim();
            if (jm) return { name: jm };
            if (typeof agent.model === 'string' && (agent.model as string).trim()) return { name: (agent.model as string).trim() };
            if (agent.model && typeof agent.model === 'object') {
                const modelObj = agent.model as any;
                const name = (modelObj.name || modelObj.model || '').trim();
                const provider = (modelObj.provider || '').trim();
                if (name) return { name, provider: provider || undefined };
            }
            return { name: 'gpt-5.4-mini' };
        })();

        const adkRequest = {
            agent: agentConfig[0],
            test_cases: dataset.items.map(item => ({
                input: { messages: [{ role: 'user', content: item.question }] },
                reference_output: { messages: [{ role: 'assistant', content: item.reference_answer }] },
            })),
            trajectory_match_mode: mode,
            session_id: `eval_${randomUUID()}_run_${runIndex}`,
            user_id: userId,
            threshold: threshold || 0.7,
            num_runs: 1,
            judge_model: selectedJudgeModel,
        };

        const response = await axios.post(
            `${this.adkUrl}/evaluation-batch/execute_agent_evaluator`,
            adkRequest,
            {
                headers: { 'Content-Type': 'application/json', 'x-api-key': this.adkApiKey },
                responseType: 'stream',
                timeout: 900000, // 15 minutes
            },
        );

        const runResults = await this.consumeAdkStream(response.data, runIndex);

        // Persist results to DB
        if (runResults.length > 0) {
            await this.evaluations.appendRunResults(evaluationId, runResults);
        }

        return { results: runResults, runIndex };
    }

    /**
     * Consumes the ADK streaming response and collects all results.
     */
    private async consumeAdkStream(stream: any, runIndex: number): Promise<any[]> {
        const results: any[] = [];

        return new Promise((resolve, reject) => {
            let buffer = '';

            stream.on('data', (chunk: Buffer) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    try {
                        let data: any;
                        if (trimmed.startsWith('data: ')) {
                            data = JSON.parse(trimmed.substring(6));
                        } else if (trimmed.startsWith('{')) {
                            data = JSON.parse(trimmed);
                        } else {
                            continue;
                        }

                        if (data.type === 'progress' && data.test_case) {
                            const transformed = this.transformTestCase(data.test_case, runIndex);
                            results.push(transformed);
                        }
                    } catch (e) {
                        this.logger.warn('Failed to parse ADK stream line', e);
                    }
                }
            });

            stream.on('end', () => {
                // Process any remaining buffer
                if (buffer.trim()) {
                    try {
                        let data: any;
                        const trimmed = buffer.trim();
                        if (trimmed.startsWith('data: ')) {
                            data = JSON.parse(trimmed.substring(6));
                        } else if (trimmed.startsWith('{')) {
                            data = JSON.parse(trimmed);
                        }
                        if (data?.type === 'progress' && data.test_case) {
                            results.push(this.transformTestCase(data.test_case, runIndex));
                        }
                    } catch (e) {
                        // ignore trailing buffer parse errors
                    }
                }
                resolve(results);
            });

            stream.on('error', (err: any) => {
                reject(err);
            });
        });
    }

    /**
     * Transforms an ADK test_case into our EvaluationIteration format.
     */
    private transformTestCase(testCase: any, runIndex: number) {
        return {
            iterationIndex: testCase.test_number || 0,
            question: testCase.question || '',
            agentAnswer: testCase.agent_answer || '',
            referenceAnswer: testCase.reference_answer || '',
            responseMatchScore: {
                score: this.extractScore(testCase.response_match_score || testCase.semantic_score),
                reasoning: testCase.evaluations?.trajectory_match?.reasoning || '',
            },
            finalResponseMatchV2: {
                score: this.extractScore(testCase.final_response_match_v2 || testCase.response_match_score),
                reasoning: testCase.final_response_match_v2?.reasoning || testCase.evaluations?.llm_judge?.reasoning || '',
            },
            hallucinationsV1: {
                score: this.extractScore(testCase.hallucinations_v1 || testCase.hallucination_score),
                reasoning: testCase.hallucinations_v1?.reasoning || '',
            },
            timestamp: new Date().toISOString(),
            runIndex,
        };
    }

    /**
     * Marks an evaluation as completed or failed.
     */
    async finalizeEvaluation(userId: string, permissions: string[], evaluationId: string, status: 'completed' | 'failed', error?: string): Promise<EvaluationRecord> {
        if (status !== 'completed' && status !== 'failed') {
            throw new BadRequestException(`Invalid evaluation status "${String(status)}"`);
        }
        const evaluation = await this.evaluations.findById(evaluationId);
        if (!evaluation) throw new NotFoundException(ErrorCode.NOT_FOUND);
        await this.assertCanManageAgent(userId, permissions, evaluation.agentId);

        const updated = await this.evaluations.finalize(evaluationId, status, error);
        if (!updated) throw new NotFoundException(ErrorCode.NOT_FOUND);
        return updated;
    }

    async findEvaluationsByAgent(userId: string, agentId: string): Promise<EvaluationRecord[]> {
        await this.agentService.findUserAgentById(userId, agentId);
        return this.evaluations.findByAgent(agentId);
    }

    async findEvaluationById(id: string): Promise<EvaluationRecord> {
        const evaluation = await this.evaluations.findById(id);
        if (!evaluation) throw new NotFoundException(ErrorCode.NOT_FOUND);
        return evaluation;
    }

    async findEvaluationByIdForUser(userId: string, id: string): Promise<EvaluationRecord> {
        const evaluation = await this.findEvaluationById(id);
        await this.agentService.findUserAgentById(userId, evaluation.agentId);
        return evaluation;
    }

    async deleteEvaluation(userId: string, permissions: string[], id: string): Promise<void> {
        const evaluation = await this.evaluations.findById(id);
        if (!evaluation) throw new NotFoundException(ErrorCode.NOT_FOUND);
        await this.assertCanManageAgent(userId, permissions, evaluation.agentId);
        await this.evaluations.deleteById(id);
    }

    private async assertCanManageAgent(userId: string, permissions: string[], agentId: string) {
        const agent = await this.agentService.findUserAgentById(userId, agentId);
        if (agent.isDefault) {
            if (!this.hasAgentManagerPermission(permissions)) {
                throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_DEFAULT_READONLY);
            }
            return agent;
        }

        const canWrite = await this.agentService.canWriteAgent(userId, agentId);
        if (!canWrite) {
            throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_SHARE_FORBIDDEN);
        }
        return agent;
    }

    private hasAgentManagerPermission(permissions: string[]): boolean {
        return permissions.some(
            (permission) => permission === '*' || permission === 'agents.*' || permission === 'agents.update',
        );
    }

    private extractScore(val: any): number {
        if (typeof val === 'number') return val;
        if (!val || typeof val !== 'object') return 0;
        if (typeof val.score === 'number') return val.score;
        if (typeof val.responseMatchScore === 'number') return val.responseMatchScore;
        if (typeof val.hallucinationScore === 'number') return val.hallucinationScore;
        if (typeof val.semanticScore === 'number') return val.semanticScore;
        return 0;
    }
}
