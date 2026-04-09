import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import axios from 'axios';
import { Evaluation, EvaluationDocument } from './schemas/evaluation.schema';
import { Dataset, DatasetDocument } from './schemas/dataset.schema';
import { AgentService } from '../agent/agent.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ErrorCode } from '../exceptions/constants/error-codes';

@Injectable()
export class EvaluationService {
    private readonly logger = new Logger(EvaluationService.name);
    private readonly adkUrl: string;

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
        idToken: string, // Needed for ADK auth if required
        threshold?: number,
    ): Promise<Evaluation> {
        // 1. Get Agent Config
        const agent = await this.agentService.findUserAgentById(userId, agentId);
        if (!agent) throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);

        // Build the agent suggestion as expected by ADK
        const agentConfig = await this.agentService.buildAgentsForStream(userId, undefined, [agentId]);
        if (!agentConfig || agentConfig.length === 0) {
            throw new Error('Failed to build agent configuration for evaluation');
        }

        // 2. Get Dataset
        const dataset = await this.findDatasetById(datasetId);

        // 3. Create Evaluation entry in DB
        const evaluation = await this.evaluationModel.create({
            agentId: new Types.ObjectId(agentId),
            scenarioName,
            mode,
            status: 'processing',
            createdBy: new Types.ObjectId(userId),
        });

        // 4. Call ADK API
        try {
            const adkRequest = {
                agent_id: agentId,
                agent_config: agentConfig[0], // Pass the resolved agent config
                dataset: dataset.items.map(item => ({
                    question: item.question,
                    reference_answer: item.reference_answer,
                })),
                num_runs: numRuns,
                mode,
                scenario_name: scenarioName,
                threshold: threshold || 0.7,
            };

            this.logger.log(`Launching ADK evaluation for agent ${agentId}, ID: ${evaluation._id}`);

            const response = await axios.post(`${this.adkUrl}/evaluation-batch/launch`, adkRequest, {
                headers: {
                    Authorization: idToken.startsWith('Bearer ') ? idToken : `Bearer ${idToken}`,
                },
                timeout: 300000, // 5 minutes
            });

            const adkEvalId = response.data.evaluation_id;

            // Start background polling (Simplified for POC)
            this.pollEvaluationStatus(evaluation._id.toString(), adkEvalId, idToken);

            return evaluation;
        } catch (error: any) {
            this.logger.error(`Failed to launch evaluation on ADK: ${error.message}`);
            evaluation.status = 'failed';
            evaluation.error = error.message;
            await evaluation.save();
            throw error;
        }
    }

    async pollEvaluationStatus(evalId: string, adkEvalId: string, idToken: string) {
        const poll = async () => {
            try {
                const response = await axios.get(`${this.adkUrl}/evaluation-batch/status/${adkEvalId}`, {
                    headers: {
                        Authorization: idToken.startsWith('Bearer ') ? idToken : `Bearer ${idToken}`,
                    },
                });

                const adkStatus = response.data.status;
                const results = response.data.results;

                if (adkStatus === 'completed' || adkStatus === 'failed') {
                    const evaluation = await this.evaluationModel.findById(evalId);
                    if (evaluation) {
                        evaluation.status = adkStatus === 'completed' ? 'completed' : 'failed';
                        evaluation.results = results;
                        if (adkStatus === 'failed') evaluation.error = response.data.error;
                        await evaluation.save();
                        this.logger.log(`Evaluation ${evalId} finished with status: ${adkStatus}`);
                    }
                    return; // Stop polling
                }

                // Still processing, poll again later
                setTimeout(poll, 5000);
            } catch (error: any) {
                this.logger.error(`Error polling evaluation ${evalId}: ${error.message}`);
                // Optional: retry or fail after N attempts
                setTimeout(poll, 10000);
            }
        };

        setTimeout(poll, 2000);
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
        console.log('--- [START] executeEvaluationSync ---');
        const stream = this.executeEvaluationStreaming(
            userId,
            agentId,
            datasetId,
            numRuns,
            mode,
            scenarioName,
            authHeader,
            judgeModel,
            threshold,
        );

        let capturedId = null;
        let finalEvaluation: any = null;

        try {
            for await (const data of stream) {
                // Capture ID from init chunk
                if (data.type === 'init' && data.evaluation_id) {
                    capturedId = data.evaluation_id;
                }
                // We just wait for iterations or final results
                if (data.type === 'final' || data.results) {
                    finalEvaluation = data;
                }
            }
            console.log('--- [SUCCESS] executeEvaluationSync Completed ---');
            
            // If we didn't get a final object but we have an ID, fetch what we have in DB
            if (!finalEvaluation && capturedId) {
                return await this.evaluationModel.findById(capturedId).exec();
            }
            
            return finalEvaluation;
        } catch (error) {
            console.error('--- [ERROR] executeEvaluationSync Failed ---', error);
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
    ): AsyncGenerator<any, void, unknown> {
        // 1. Get Agent Config
        const agent = await this.agentService.findUserAgentById(userId, agentId);
        if (!agent) throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);

        const agentConfig = await this.agentService.buildAgentsForStream(userId, undefined, [agentId]);

        // 2. Get Dataset
        const dataset = await this.findDatasetById(datasetId);

        // 3. Prepare ADK Request
        const adkRequest = {
            agent: agentConfig[0],
            test_cases: dataset.items.map(item => ({
                input: { messages: [{ role: 'user', content: item.question }] },
                reference_output: { messages: [{ role: 'assistant', content: item.reference_answer }] },
            })),
            trajectory_match_mode: mode,
            session_id: `eval_${uuidv4()}`,
            user_id: userId,
            threshold: threshold || 0.7,
            num_runs: numRuns || 1,
            judge_model: judgeModel ? { name: judgeModel } : (typeof agent.model === 'string' ? { name: agent.model } : agent.model),
        };

        // 4. Create Evaluation entry in DB (initially)
        const evaluation = await this.evaluationModel.create({
            agentId: new Types.ObjectId(agentId),
            scenarioName,
            mode,
            status: 'processing',
            createdBy: new Types.ObjectId(userId),
        });

        yield { type: 'init', evaluation_id: evaluation._id.toString() };

        const detailedResults: any[] = [];
        let finalEvaluation: any = null;
        
        const extractText = (val: any): string => {
            if (!val) return "";
            if (typeof val === 'string') return val;
            if (Array.isArray(val)) {
                return val.map(v => extractText(v)).join("\n");
            }
            if (typeof val === 'object') {
                if (val.content) return val.content;
                if (val.messages && Array.isArray(val.messages)) {
                    return val.messages.map((m: any) => m.content || "").filter(Boolean).join("\n");
                }
                return JSON.stringify(val);
            }
            return String(val);
        };

        try {
            const response = await axios.post(`${this.adkUrl}/evaluation-batch/execute_agent_evaluator`, adkRequest, {
                headers: {
                    Authorization: idToken.startsWith('Bearer ') ? idToken : `Bearer ${idToken}`,
                    Accept: 'text/event-stream',
                },
                responseType: 'stream',
                timeout: 60000, // 60 seconds timeout
            });

            const stream = response.data;
            let buffer = '';

            for await (const chunk of stream) {
                try {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed.startsWith('data: ')) {
                            const data = JSON.parse(trimmed.substring(6));

                            // Capture final results for consolidated mapping
                            if (data.type === 'final' || data.results) {
                                finalEvaluation = data;
                            }

                            if (data.type === 'progress') {
                                const res = data.test_case;
                                const responseMatch = res.response_match_score ?? res.responseMatchScore ?? 0;
                                const hallucination = res.hallucination_score ?? res.hallucinationScore ?? 0;
                                
                                const matchReasoning = res.evaluations?.trajectory_match?.reasoning || res.evaluations?.llm_judge?.reasoning;
                                const reasoning = typeof matchReasoning === 'string' ? matchReasoning : (res.error || "No reasoning provided");

                                const matchV2Score = res.evaluations?.final_response_match_v2?.score ?? res.final_response_match_v2?.score ?? responseMatch;
                                const matchV2Reasoning = res.evaluations?.final_response_match_v2?.reasoning || res.final_response_match_v2?.reasoning || reasoning;

                                const newIteration = {
                                    iterationIndex: res.test_number || (detailedResults.length + 1),
                                    question: extractText(res.question || res.input || res.user_input || res.user_msg || (typeof res.input === 'object' ? JSON.stringify(res.input) : "---")),
                                    agentAnswer: extractText(res.agent_answer || res.agentAnswer || res.actual || res.actual_output || res.agent_ans || res.actualOutput || ""),
                                    referenceAnswer: extractText(res.reference_answer || res.expectedAnswer || res.expected || res.expected_output || res.ref_msg || res.expected_answer || res.expectedOutput || ""),
                                    responseMatchScore: { score: responseMatch, reasoning: reasoning },
                                    finalResponseMatchV2: { score: matchV2Score, reasoning: matchV2Reasoning },
                                    hallucinationsV1: { score: hallucination, reasoning: typeof res.evaluations?.llm_judge?.reasoning === 'string' ? res.evaluations?.llm_judge?.reasoning : null },
                                    timestamp: new Date().toISOString()
                                };

                                detailedResults.push(res);
                                data.test_case = { ...res, ...newIteration };
                                yield data;

                                this.evaluationModel.findByIdAndUpdate(evaluation._id, {
                                    $push: { results: newIteration }
                                }).catch(err => this.logger.error(`Failed to save progress to DB: ${err.message}`));
                            } else {
                                yield data;
                            }
                        }
                    }
                } catch (innerError: any) {
                    this.logger.error(`Error processing stream chunk: ${innerError.message}`);
                    continue; // Skip faulty chunk instead of crashing
                }
            }

            evaluation.status = 'completed';

            // Intelligently merge results: take the final packet if complete, otherwise use accumulated detailedResults
            const finalResultsArray = finalEvaluation?.details || finalEvaluation?.detailed_results || [];
            const resultsToMap = finalResultsArray.length >= detailedResults.length ? finalResultsArray : detailedResults;
            
            evaluation.results = resultsToMap.map((res: any, index: number) => {
                const responseMatch = res.response_match_score ?? res.responseMatchScore ?? 0;
                const hallucination = res.hallucination_score ?? res.hallucinationScore ?? 0;
                
                const matchReasoning = res.evaluations?.trajectory_match?.reasoning || res.evaluations?.llm_judge?.reasoning || res.error || "No reasoning provided";
                const reasoning = typeof matchReasoning === 'string' ? matchReasoning : (res.error || "No reasoning provided");

                const matchV2Score = res.evaluations?.final_response_match_v2?.score ?? res.final_response_match_v2?.score ?? responseMatch;
                const matchV2Reasoning = res.evaluations?.final_response_match_v2?.reasoning || res.final_response_match_v2?.reasoning || reasoning;

                return {
                    iterationIndex: res.test_number || (index + 1),
                    question: extractText(res.question || res.input || res.user_input || res.user_msg),
                    agentAnswer: extractText(res.agent_answer || res.agentAnswer || res.actual || res.actual_output || res.agent_ans || res.actualOutput),
                    referenceAnswer: extractText(res.reference_answer || res.expectedAnswer || res.expected || res.expected_output || res.ref_msg || res.expected_answer || res.expectedOutput),
                    responseMatchScore: { score: responseMatch, reasoning: reasoning },
                    finalResponseMatchV2: { score: matchV2Score, reasoning: matchV2Reasoning },
                    hallucinationsV1: { score: hallucination, reasoning: typeof res.evaluations?.llm_judge?.reasoning === 'string' ? res.evaluations?.llm_judge?.reasoning : null },
                    timestamp: new Date().toISOString()
                };
            });
            await evaluation.save();

        } catch (error: any) {
            this.logger.error(`SSE proxy error: ${error.message}`);
            evaluation.status = 'failed';
            evaluation.error = error.message;
            await evaluation.save();
            yield { type: 'error', error: error.message };
        }
    }

    async findEvaluationsByAgent(agentId: string): Promise<Evaluation[]> {
        return this.evaluationModel
            .find({ agentId: new Types.ObjectId(agentId) })
            .sort({ createdAt: -1 })
            .exec();
    }

    async deleteEvaluation(userId: string, id: string): Promise<void> {
        const evaluation = await this.evaluationModel.findById(id).exec();
        if (!evaluation) {
            throw new NotFoundException(ErrorCode.NOT_FOUND);
        }

        // Simple ownership check: either direct creator or has access to the agent
        if (evaluation.createdBy && evaluation.createdBy.toString() !== userId) {
            const agent = await this.agentService.findUserAgentById(userId, evaluation.agentId.toString());
            if (!agent) {
                throw new ForbiddenException(ErrorCode.FORBIDDEN);
            }
        }

        await this.evaluationModel.findByIdAndDelete(id).exec();
    }
}

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
