import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS, AUTH_STORAGE_KEYS, API_CONFIG } from '@/lib/api/config';

export interface DatasetItem {
    question: string;
    reference_answer: string;
}

export interface Dataset {
    id: string;
    name: string;
    items: DatasetItem[];
}

export interface MetricResult {
    score: number;
    reasoning?: string;
}

export interface EvaluationIteration {
    iterationIndex: number;
    question?: string;
    referenceAnswer?: string;
    agentAnswer?: string;
    responseMatchScore: MetricResult;
    finalResponseMatchV2: MetricResult;
    hallucinationsV1: MetricResult;
    timestamp: string;
    runIndex: number;
    status?: 'success' | 'failed';
    error?: string;
}

export interface Evaluation {
    id: string;
    agentId: string;
    scenarioName: string;
    mode: 'strict' | 'non_strict';
    status: 'processing' | 'completed' | 'failed';
    numRuns?: number;
    datasetId?: string;
    results: EvaluationIteration[];
    error?: string;
    createdAt: string;
}

export async function getDatasets(): Promise<Dataset[]> {
    const response = await apiClient.get<ApiResponse<Dataset[]>>(
        API_ENDPOINTS.evaluation.datasets
    );
    return response.data.data;
}

export async function createDataset(name: string, items: DatasetItem[]): Promise<Dataset> {
    const response = await apiClient.post<ApiResponse<Dataset>>(
        API_ENDPOINTS.evaluation.datasets,
        { name, items }
    );
    return response.data.data;
}

export async function deleteDataset(id: string): Promise<void> {
    await apiClient.delete(API_ENDPOINTS.evaluation.datasetById(id));
}

export interface LaunchEvaluationData {
    agentId: string;
    datasetId: string;
    numRuns: number;
    mode: string;
    scenarioName: string;
    judgeModel?: string;
    threshold?: number;
}

export async function launchEvaluation(data: LaunchEvaluationData): Promise<Evaluation> {
    const response = await apiClient.post<ApiResponse<Evaluation>>(
        API_ENDPOINTS.evaluation.launch,
        data
    );
    return response.data.data;
}

export interface Scenario {
    id: string;
    name: string;
    agentId: string;
    datasetId?: string;
    numRuns: number;
    mode: string;
}

export async function getScenarios(agentId: string): Promise<Scenario[]> {
    const response = await apiClient.get<ApiResponse<Scenario[]>>(
        API_ENDPOINTS.evaluation.scenariosByAgent(agentId)
    );
    return response.data.data;
}

export async function createScenario(data: Partial<Scenario>): Promise<Scenario> {
    const response = await apiClient.post<ApiResponse<Scenario>>(
        API_ENDPOINTS.evaluation.scenarios,
        data
    );
    return response.data.data;
}

export async function updateScenario(id: string, data: Partial<Scenario>): Promise<Scenario> {
    const response = await apiClient.put<ApiResponse<Scenario>>(
        API_ENDPOINTS.evaluation.scenarioById(id),
        data
    );
    return response.data.data;
}

export async function deleteScenario(id: string): Promise<void> {
    await apiClient.delete(API_ENDPOINTS.evaluation.scenarioById(id));
}

export async function getAgentEvaluations(agentId: string): Promise<Evaluation[]> {
    const response = await apiClient.get<ApiResponse<Evaluation[]>>(
        API_ENDPOINTS.evaluation.results(agentId)
    );
    return response.data.data;
}

export async function deleteEvaluation(id: string): Promise<void> {
    await apiClient.delete(API_ENDPOINTS.evaluation.resultById(id));
}

export async function executeEvaluation(data: LaunchEvaluationData): Promise<Evaluation> {
    const response = await apiClient.post<ApiResponse<Evaluation>>(
        '/evaluation/execute',
        data,
        { timeout: 300000 } // 5 minutes timeout for evaluations
    );
    return response.data.data;
}
