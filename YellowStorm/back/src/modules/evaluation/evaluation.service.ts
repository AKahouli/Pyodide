import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Evaluation, EvaluationDocument } from './schemas/evaluation.schema';
import { Dataset, DatasetDocument } from './schemas/dataset.schema';
import { AgentService } from '../agent/agent.service';
import { ErrorCode } from '../exceptions/constants/error-codes';

@Injectable()
export class EvaluationService {
    private readonly logger = new Logger(EvaluationService.name);
    private readonly adkUrl: string;
    private readonly adkApiKey: string;

    constructor(
        @InjectModel(Evaluation.name)
        private readonly evaluationModel: Model<EvaluationDocument>,
        @InjectModel(Dataset.name)
        private readonly datasetModel: Model<DatasetDocument>,
        private readonly agentService: AgentService,
        private readonly configService: ConfigService,
    ) {
        this.adkUrl = this.configService.get<string>('indexing.apiAdk') || 'http://localhost:8000';
        this.adkApiKey = this.configService.get<string>('indexing.adkApiKey') || '';
    }

    // ==========================================
    // Dataset Methods
    // ==========================================

    async createDataset(userId: string, name: string, items: any[]): Promise<Dataset> {
        const dataset = await this.datasetModel.create({
            name,
            items,
            createdBy: new Types.ObjectId(userId),
        });
        return dataset;
    }

    async findAllDatasets(userId: string): Promise<Dataset[]> {
        return this.datasetModel.find({ createdBy: new Types.ObjectId(userId) }).exec();
    }

    async findDatasetById(id: string): Promise<Dataset> {
        if (!id || id === 'undefined' || id === '') {
            throw new NotFoundException('Dataset ID is missing or invalid');
        }
        const dataset = await this.datasetModel.findById(id).exec();
        if (!dataset) throw new NotFoundException(ErrorCode.NOT_FOUND);
        return dataset;
    }

    async deleteDataset(id: string): Promise<void> {
        await this.datasetModel.findByIdAndDelete(id).exec();
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
        agentId: string,
        datasetId: string,
        numRuns: number,
        mode: string,
        scenarioName: string,
    ): Promise<Evaluation> {
        const agent = await this.agentService.findUserAgentById(userId, agentId);
        if (!agent) throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);

        await this.findDatasetById(datasetId);

        const evaluation = await this.evaluationModel.create({
            agentId: new Types.ObjectId(agentId),
            scenarioName,
            datasetId: new Types.ObjectId(datasetId),
            mode,
            status: 'processing',
            createdBy: new Types.ObjectId(userId),
            numRuns: numRuns || 1,
            completedRuns: 0,
        });

        return evaluation;
    }

    /**
     * Runs a single evaluation run against the ADK.
     * Waits for the ADK to finish and returns the results.
     */
    async runSingleEvaluation(
        userId: string,
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
        const agent = await this.agentService.findUserAgentById(userId, agentId);
        if (!agent) throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);

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
            session_id: `eval_${this.uuidv4()}_run_${runIndex}`,
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
            await this.evaluationModel.findByIdAndUpdate(evaluationId, {
                $push: { results: { $each: runResults } },
                $inc: { completedRuns: 1 },
            });
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
    async finalizeEvaluation(userId: string, evaluationId: string, status: 'completed' | 'failed', error?: string): Promise<Evaluation> {
        const evaluation = await this.evaluationModel.findById(evaluationId).exec();
        if (!evaluation) throw new NotFoundException(ErrorCode.NOT_FOUND);

        const update: any = { status };
        if (error) update.error = error;

        const updated = await this.evaluationModel.findByIdAndUpdate(evaluationId, update, { new: true }).exec();
        if (!updated) throw new NotFoundException(ErrorCode.NOT_FOUND);
        return updated;
    }

    async findEvaluationsByAgent(agentId: string): Promise<Evaluation[]> {
        return this.evaluationModel.find({ agentId: new Types.ObjectId(agentId) }).sort({ createdAt: -1 }).exec();
    }

    async findEvaluationById(id: string): Promise<Evaluation> {
        const evaluation = await this.evaluationModel.findById(id).exec();
        if (!evaluation) throw new NotFoundException(ErrorCode.NOT_FOUND);
        return evaluation;
    }

    async deleteEvaluation(userId: string, id: string): Promise<void> {
        const evaluation = await this.evaluationModel.findById(id).exec();
        if (!evaluation) throw new NotFoundException(ErrorCode.NOT_FOUND);
        if (evaluation.createdBy && evaluation.createdBy.toString() !== userId) {
            const agent = await this.agentService.findUserAgentById(userId, evaluation.agentId.toString());
            if (!agent) throw new ForbiddenException(ErrorCode.FORBIDDEN);
        }
        await this.evaluationModel.findByIdAndDelete(id).exec();
    }

    private uuidv4() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
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
