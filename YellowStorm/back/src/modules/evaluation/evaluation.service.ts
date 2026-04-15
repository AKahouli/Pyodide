import { Injectable, Logger, NotFoundException, ForbiddenException, MessageEvent } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
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
    private readonly evaluationSubject = new Subject<{ userId: string; data: any }>();

    constructor(
        @InjectModel(Evaluation.name)
        private readonly evaluationModel: Model<EvaluationDocument>,
        @InjectModel(Dataset.name)
        private readonly datasetModel: Model<DatasetDocument>,
        private readonly agentService: AgentService,
        private readonly configService: ConfigService,
    ) {
        this.adkUrl = this.configService.get<string>('indexing.apiAdk') || 'http://localhost:8000';
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

    async launchEvaluation(
        userId: string,
        agentId: string,
        datasetId: string,
        numRuns: number,
        mode: string,
        scenarioName: string,
        idToken: string,
        threshold?: number,
    ): Promise<Evaluation> {
        const agent = await this.agentService.findUserAgentById(userId, agentId);
        if (!agent) throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);

        const agentConfig = await this.agentService.buildAgentsForStream(userId, undefined, [agentId]);
        const dataset = await this.findDatasetById(datasetId);

        const evaluation = await this.evaluationModel.create({
            agentId: new Types.ObjectId(agentId),
            scenarioName,
            datasetId: new Types.ObjectId(datasetId),
            mode,
            status: 'processing',
            createdBy: new Types.ObjectId(userId),
            numRuns: numRuns || 1,
        });

        try {
            const adkRequest = {
                agent_id: agentId,
                agent_config: agentConfig[0],
                dataset: dataset.items.map(item => ({
                    question: item.question,
                    reference_answer: item.reference_answer,
                })),
                num_runs: numRuns,
                mode,
                scenario_name: scenarioName,
                threshold: threshold || 0.7,
            };

            const response = await axios.post(`${this.adkUrl}/evaluation-batch/launch`, adkRequest, {
                headers: { Authorization: idToken.startsWith('Bearer ') ? idToken : `Bearer ${idToken}` },
                timeout: 300000,
            });

            this.pollEvaluationStatus(userId, evaluation._id.toString(), response.data.evaluation_id, idToken);
            return evaluation;
        } catch (error: any) {
            evaluation.status = 'failed';
            evaluation.error = error.message;
            await evaluation.save();
            throw error;
        }
    }

    async pollEvaluationStatus(userId: string, evalId: string, adkEvalId: string, idToken: string) {
        const poll = async () => {
            try {
                const response = await axios.get(`${this.adkUrl}/evaluation-batch/status/${adkEvalId}`, {
                    headers: { Authorization: idToken.startsWith('Bearer ') ? idToken : `Bearer ${idToken}` },
                });
                
                const { status, results, error } = response.data;
                if (status === 'completed' || status === 'failed') {
                    const updated = await this.evaluationModel.findByIdAndUpdate(evalId, {
                        status: status === 'completed' ? 'completed' : 'failed',
                        results: results,
                        error: error
                    }, { new: true });
                    
                    // Notify via SSE
                    this.evaluationSubject.next({
                        userId,
                        data: {
                            type: 'completed',
                            evaluation_id: evalId,
                            evaluation: updated
                        }
                    });

                    return;
                }
                setTimeout(poll, 5000);
            } catch (err) {
                this.logger.error(`Polling failed for ${adkEvalId}`, err);
                setTimeout(poll, 10000);
            }
        };
        setTimeout(poll, 2000);
    }

    getEvaluationUpdates(userId: string): Observable<MessageEvent> {
        return this.evaluationSubject.asObservable().pipe(
            filter(event => event.userId === userId),
            map(event => ({ data: event.data } as MessageEvent))
        );
    }

    /**
     * Synchronous execution (Aligns with Whitelabel project)
     * Collects all stream results and returns one final object.
     */
    async executeEvaluationSync(
        userId: string,
        agentId: string,
        datasetId: string,
        numRuns: number,
        mode: string,
        scenarioName: string,
        authHeader: string,
        judgeModel?: string,
        threshold?: number,
    ) {
        const stream = this.executeEvaluationStreaming(
            userId, agentId, datasetId, numRuns, mode, scenarioName, authHeader, judgeModel, threshold,
        );

        let capturedId = null;
        let finalEvaluation: any = null;

        try {
            for await (const data of stream) {
                if (data.type === 'init' && data.evaluation_id) capturedId = data.evaluation_id;
                if (data.type === 'final' || data.results || data.type === 'completed') finalEvaluation = data;
            }
            if (!finalEvaluation && capturedId) return await this.evaluationModel.findById(capturedId).exec();
            return finalEvaluation;
        } catch (error) {
            this.logger.error('executeEvaluationSync Failed', error);
            throw error;
        }
    }

    async *executeEvaluationStreaming(
        userId: string,
        agentId: string,
        datasetId: string,
        numRuns: number,
        mode: string,
        scenarioName: string,
        idToken: string,
        judgeModel?: string,
        threshold?: number,
        resumeId?: string,
    ): AsyncGenerator<any, void, unknown> {
        yield { type: 'init', status: 'connected', message: 'Evaluation request accepted' };

        try {
            const agent = await this.agentService.findUserAgentById(userId, agentId);
            if (!agent) throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);

            const agentConfig = await this.agentService.buildAgentsForStream(userId, undefined, [agentId]);
            
            // Allow resuming without explicit datasetId if we can find it in the DB (once we start saving it)
            let effectiveDatasetId = datasetId;
            if (!effectiveDatasetId || effectiveDatasetId === '') {
                // If it's a resume scenario (should have an evaluation_id mentioned somewhere)
                // For now, let's just fail gracefully if datasetId is blank
                throw new Error('Dataset ID is required to start or resume evaluation');
            }

            const dataset = await this.findDatasetById(effectiveDatasetId);

            const adkRequest = {
                agent: agentConfig[0],
                test_cases: dataset.items.map(item => ({
                    input: { messages: [{ role: 'user', content: item.question }] },
                    reference_output: { messages: [{ role: 'assistant', content: item.reference_answer }] },
                })),
                trajectory_match_mode: mode,
                session_id: `eval_${this.uuidv4()}`,
                user_id: userId,
                threshold: threshold || 0.7,
                num_runs: numRuns || 1,
                judge_model: (() => {
                // Priority 1: explicit judgeModel from the request
                const jm = (judgeModel || '').trim();
                if (jm) return { name: jm };
                // Priority 2: agent.model field
                if (typeof agent.model === 'string' && agent.model.trim()) return { name: agent.model.trim() };
                if (agent.model && typeof agent.model === 'object') {
                    const modelObj = agent.model as any;
                    const name = (modelObj.name || modelObj.model || '').trim();
                    const provider = (modelObj.provider || '').trim();
                    if (name) return { name, provider: provider || undefined };
                }
                // Fallback: let the Python ADK use its own default
                return { name: 'gpt-5.4-mini' };
            })(),
            };

            let evaluation: any;
            if (resumeId && resumeId !== '') {
                evaluation = await this.evaluationModel.findById(resumeId);
                if (!evaluation) {
                    this.logger.warn(`Resume ID ${resumeId} provided but not found in DB. Creating new evaluation.`);
                }
            }

            if (!evaluation) {
                // Security check for very rapid duplicate launches (de-duplication)
                // We check for ANY evaluation with same params created in the last 10 minutes
                // (Relaxed from 'processing' only to avoid duplicates when first check finishes fast)
                const tenMinutesAgo = new Date();
                tenMinutesAgo.setMinutes(tenMinutesAgo.getMinutes() - 10);

                const existingDuplicate = await this.evaluationModel.findOne({
                    agentId: new Types.ObjectId(agentId),
                    scenarioName,
                    datasetId: new Types.ObjectId(datasetId),
                    mode,
                    createdBy: new Types.ObjectId(userId),
                    createdAt: { $gte: tenMinutesAgo }
                }).sort({ createdAt: -1 }).exec();

                if (existingDuplicate) {
                    this.logger.log(`De-duplication: Reusing recently created evaluation ${existingDuplicate._id} (Status: ${existingDuplicate.status})`);
                    evaluation = existingDuplicate;
                }
            }

            if (!evaluation) {
                evaluation = await this.evaluationModel.create({
                    agentId: new Types.ObjectId(agentId),
                    scenarioName,
                    datasetId: new Types.ObjectId(datasetId),
                    mode,
                    status: 'processing',
                    createdBy: new Types.ObjectId(userId),
                    numRuns: numRuns || 1,
                });
            } else {
                // If resuming or de-duplicating, clear old error, reset results, and ensure status is processing
                evaluation.status = 'processing';
                evaluation.error = undefined;
                evaluation.results = []; // Reset results to avoid duplicates on retry
                await evaluation.save();
            }

            yield { type: 'init', evaluation_id: evaluation._id.toString(), message: 'Syncing agent configuration...' };

            const totalRuns = numRuns || 1;
            const allDetailedResults: any[] = [];
            let finalBaseEvaluation: any = null;

            for (let runIndex = 0; runIndex < totalRuns; runIndex++) {
                // Update session ID and force num_runs to 1 for the ADK payload
                const currentAdkRequest = {
                    ...adkRequest,
                    session_id: `eval_${this.uuidv4()}_run_${runIndex + 1}`,
                    num_runs: 1,
                };

                const adkCall = axios.post(`${this.adkUrl}/evaluation-batch/execute_agent_evaluator`, currentAdkRequest, {
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                    responseType: 'stream',
                    timeout: 900000,
                });

                let response: any;
                let setupDone = false;
                
                const waitForResponse = async () => {
                    response = await adkCall;
                    setupDone = true;
                };
                
                const responsePromise = waitForResponse();
                
                while (!setupDone) {
                    yield { type: 'heartbeat', message: `ADK processing run ${runIndex + 1}/${totalRuns}...` };
                    const result = await Promise.race([
                        responsePromise,
                        new Promise((_, reject) => setTimeout(() => reject('timeout_internal'), 5000))
                    ]).catch(err => err);
                    
                    if (result !== 'timeout_internal') {
                        if (result instanceof Error) throw result;
                        break; 
                    }
                }

                if (!response) {
                    throw new Error(`ADK evaluation failed on run ${runIndex + 1}: Connection could not be established.`);
                }

                const stream = response.data;
                let lastHeartbeat = Date.now();
                let runFinalEval: any = null;

                const streamToAsyncGenerator = async function* (stream: any) {
                    const chunks: any[] = [];
                    let done = false;
                    stream.on('data', (chunk: any) => chunks.push(chunk));
                    stream.on('end', () => done = true);
                    stream.on('error', (err: any) => { throw err; });

                    while (!done || chunks.length > 0) {
                        if (chunks.length > 0) {
                            yield chunks.shift();
                            lastHeartbeat = Date.now();
                        } else {
                            if (Date.now() - lastHeartbeat > 15000) {
                                yield { type: 'heartbeat', message: `ADK processing run ${runIndex + 1}/${totalRuns}...` };
                                lastHeartbeat = Date.now();
                            }
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                    }
                };

                let buffer = '';
                for await (const chunk of streamToAsyncGenerator(stream)) {
                    try {
                        buffer += chunk.toString();
                        const lines = buffer.split('\n\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed) continue;

                            if (trimmed.startsWith('data: ')) {
                                const data = JSON.parse(trimmed.substring(6));
                                if (data.type === 'completed' || data.type === 'final') {
                                    runFinalEval = data;
                                } else if (data.type === 'progress') {
                                    // Transform test_case to match EvaluationIteration schema
                                    const transformedResult = {
                                        iterationIndex: data.test_case.test_number || 0,
                                        question: data.test_case.question || '',
                                        agentAnswer: data.test_case.agent_answer || '',
                                        referenceAnswer: data.test_case.reference_answer || '',
                                        responseMatchScore: {
                                            score: this.extractScore(data.test_case.response_match_score || data.test_case.semantic_score),
                                            reasoning: data.test_case.evaluations?.trajectory_match?.reasoning || ''
                                        },
                                        finalResponseMatchV2: {
                                            score: this.extractScore(data.test_case.final_response_match_v2 || data.test_case.response_match_score),
                                            reasoning: data.test_case.final_response_match_v2?.reasoning || data.test_case.evaluations?.llm_judge?.reasoning || ''
                                        },
                                        hallucinationsV1: {
                                            score: this.extractScore(data.test_case.hallucinations_v1 || data.test_case.hallucination_score),
                                            reasoning: data.test_case.hallucinations_v1?.reasoning || ''
                                        },
                                        timestamp: new Date().toISOString(),
                                        runIndex: runIndex + 1
                                    };

                                    allDetailedResults.push(transformedResult);
                                    this.evaluationModel.findByIdAndUpdate(evaluation._id, { $push: { results: transformedResult } }).catch(() => {});
                                    yield { ...data, test_case: transformedResult };
                                } else if (data.type === 'heartbeat' || data.type === 'init' || data.type === 'partial_results') {
                                    yield data;
                                }
                            } else if (trimmed.startsWith('{')) {
                                const data = JSON.parse(trimmed);
                                if (data.type === 'completed' || data.type === 'final') {
                                    runFinalEval = data;
                                } else if (data.type === 'progress') {
                                    const transformedResult = {
                                        iterationIndex: data.test_case.test_number || 0,
                                        question: data.test_case.question || '',
                                        agentAnswer: data.test_case.agent_answer || '',
                                        referenceAnswer: data.test_case.reference_answer || '',
                                        responseMatchScore: {
                                            score: this.extractScore(data.test_case.response_match_score || data.test_case.semantic_score),
                                            reasoning: data.test_case.evaluations?.trajectory_match?.reasoning || ''
                                        },
                                        finalResponseMatchV2: {
                                            score: this.extractScore(data.test_case.final_response_match_v2 || data.test_case.response_match_score),
                                            reasoning: data.test_case.final_response_match_v2?.reasoning || data.test_case.evaluations?.llm_judge?.reasoning || ''
                                        },
                                        hallucinationsV1: {
                                            score: this.extractScore(data.test_case.hallucinations_v1 || data.test_case.hallucination_score),
                                            reasoning: data.test_case.hallucinations_v1?.reasoning || ''
                                        },
                                        timestamp: new Date().toISOString(),
                                        runIndex: runIndex + 1
                                    };

                                    allDetailedResults.push(transformedResult);
                                    this.evaluationModel.findByIdAndUpdate(evaluation._id, { $push: { results: transformedResult } }).catch(() => {});
                                    yield { ...data, test_case: transformedResult };
                                } else {
                                    yield data;
                                }
                            }
                        }
                    } catch (e) {
                        this.logger.warn('Failed to parse stream line', e);
                    }
                }
                
                if (runFinalEval) {
                    finalBaseEvaluation = runFinalEval;
                }
            }

            if (finalBaseEvaluation) {
                const totalTestsCount = allDetailedResults.length;
                let accumulatedScore = 0;
                let scoredCount = 0;
                allDetailedResults.forEach(r => {
                    const ts = r.finalResponseMatchV2?.score || r.responseMatchScore?.score;
                    if (typeof ts === 'number') {
                        accumulatedScore += ts;
                        scoredCount++;
                    }
                });
                const accurateMeanScore = scoredCount > 0 ? (accumulatedScore / scoredCount) : 0;

                const finalConsolidated = {
                    ...finalBaseEvaluation,
                    total_tests: totalTestsCount,
                    score: accurateMeanScore,
                    details: allDetailedResults,
                    detailed_results: allDetailedResults,
                    type: 'completed'
                };
                
                if (finalConsolidated.summary && finalConsolidated.summary.overall) {
                    finalConsolidated.summary.overall.total_tests = totalTestsCount;
                    finalConsolidated.summary.overall.success_rate = accurateMeanScore;
                }

                await this.evaluationModel.findByIdAndUpdate(evaluation._id, {
                    status: 'completed',
                    results: allDetailedResults
                });

                yield finalConsolidated;
            }

        } catch (error: any) {
            this.logger.error(`SSE Stream Error: ${error.message}`);
            yield { type: 'error', error: error.message };
        }
    }

    async findEvaluationsByAgent(agentId: string): Promise<Evaluation[]> {
        return this.evaluationModel.find({ agentId: new Types.ObjectId(agentId) }).sort({ createdAt: -1 }).exec();
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
        
        // Try score property (MetricResult or ADK object)
        if (typeof val.score === 'number') return val.score;
        // Try camelCase alias from ADK
        if (typeof val.responseMatchScore === 'number') return val.responseMatchScore;
        if (typeof val.hallucinationScore === 'number') return val.hallucinationScore;
        if (typeof val.semanticScore === 'number') return val.semanticScore;
        
        return 0;
    }

    private extractReasoning(val: any): string {
        if (typeof val === 'string') return val;
        if (!val || typeof val !== 'object') return '';
        
        return val.reasoning || val.comment || '';
    }
}
