import { EventEmitter } from 'node:events';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { EvaluationService } from './evaluation.service';
import { ScenarioService } from './scenario.service';
import { PgEvaluationScenarioStore } from './persistence/pg-evaluation-scenario.store';

jest.mock('axios', () => ({ __esModule: true, default: { post: jest.fn() } }));
import axios from 'axios';
const axiosPost = axios.post as unknown as jest.Mock;

const USER_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const USER_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const AGENT_ID = 'cccccccccccccccccccccccc';
const DATASET_A = 'dddddddddddddddddddddd01';
const DATASET_B = 'dddddddddddddddddddddd02';
const EVALUATION_A = 'eeeeeeeeeeeeeeeeeeeeee01';

/** The store mocks answer exactly like the owner-scoped SQL: a foreign creator reads nothing. */
const evaluationRow = {
    id: EVALUATION_A, agentId: AGENT_ID, datasetId: DATASET_A, scenarioName: 's',
    mode: 'non_strict', results: [], numRuns: 1, completedRuns: 0, status: 'processing',
    createdBy: USER_A, createdAt: new Date(), updatedAt: new Date(),
};
const datasetRow = (id: string, createdBy: string) => ({
    id, name: 'd', items: [], createdBy, createdAt: new Date(), updatedAt: new Date(),
});

const setup = (options: { sharedAgent?: boolean } = {}) => {
    const datasets = {
        create: jest.fn(async (data: { name: string; createdBy: string }) => datasetRow('newdataset000000000000001', data.createdBy)),
        findByCreator: jest.fn(async () => []),
        findByIdForCreator: jest.fn(async (id: string, userId: string) =>
            id === DATASET_A && userId === USER_A ? datasetRow(id, USER_A)
                : id === DATASET_B && userId === USER_B ? datasetRow(id, USER_B) : null),
        deleteByIdForCreator: jest.fn(async () => undefined),
    };
    const evaluations = {
        create: jest.fn(async () => evaluationRow),
        findById: jest.fn(async (id: string, userId: string) =>
            id === EVALUATION_A && userId === USER_A ? evaluationRow : null),
        findByAgent: jest.fn(async (_agentId: string, userId: string) => (userId === USER_A ? [evaluationRow] : [])),
        appendRunResults: jest.fn(async () => undefined),
        finalize: jest.fn(async () => evaluationRow),
        deleteById: jest.fn(async () => undefined),
    };
    const agentService = {
        // Both users may manage the agent — agent access is not dataset or run ownership.
        findUserAgentById: jest.fn(async () => ({ id: AGENT_ID, isDefault: false, model: { name: 'judge' } })),
        canWriteAgent: jest.fn(async () => options.sharedAgent ?? true),
        buildAgentsForStream: jest.fn(async () => [{ name: 'agent', providers: [] }]),
    };
    const service = new EvaluationService(
        evaluations as never, datasets as never, agentService as never,
        { get: jest.fn(() => 'http://adk:8000') } as never,
    );
    const permissions: string[] = [];
    return { service, datasets, evaluations, agentService, permissions };
};

describe('EvaluationService ownership', () => {
    it('lets a creator read, list and delete their own dataset and runs', async () => {
        const { service, datasets, evaluations, permissions } = setup();
        await expect(service.findDatasetByIdForUser(USER_A, DATASET_A)).resolves.toMatchObject({ id: DATASET_A });
        await expect(service.deleteDataset(USER_A, DATASET_A)).resolves.toBeUndefined();
        expect(datasets.deleteByIdForCreator).toHaveBeenCalledWith(DATASET_A, USER_A);
        await expect(service.findEvaluationsByAgent(USER_A, AGENT_ID)).resolves.toHaveLength(1);
        expect(evaluations.findByAgent).toHaveBeenCalledWith(AGENT_ID, USER_A);
        await expect(service.findEvaluationByIdForUser(USER_A, EVALUATION_A)).resolves.toMatchObject({ id: EVALUATION_A });
        await expect(service.finalizeEvaluation(USER_A, permissions, EVALUATION_A, 'completed')).resolves.toMatchObject({ id: EVALUATION_A });
        await expect(service.deleteEvaluation(USER_A, permissions, EVALUATION_A)).resolves.toBeUndefined();
        expect(evaluations.deleteById).toHaveBeenCalledWith(EVALUATION_A, USER_A);
    });

    it('hides another creator\'s dataset: same answer as a nonexistent one, and nothing is deleted', async () => {
        const { service, datasets, permissions } = setup();
        await expect(service.findDatasetByIdForUser(USER_B, DATASET_A)).rejects.toThrow(NotFoundException);
        await expect(service.deleteDataset(USER_B, DATASET_A)).resolves.toBeUndefined();
        expect(datasets.deleteByIdForCreator).toHaveBeenCalledWith(DATASET_A, USER_B);
        await expect(service.launchEvaluation(USER_B, permissions, AGENT_ID, DATASET_A, 1, 'strict', 's')).rejects.toThrow(NotFoundException);
    });

    it('hides another creator\'s run and never mutates it', async () => {
        const { service, evaluations, permissions } = setup();
        await expect(service.findEvaluationByIdForUser(USER_B, EVALUATION_A)).rejects.toThrow(NotFoundException);
        await expect(service.finalizeEvaluation(USER_B, permissions, EVALUATION_A, 'completed')).rejects.toThrow(NotFoundException);
        await expect(service.deleteEvaluation(USER_B, permissions, EVALUATION_A)).rejects.toThrow(NotFoundException);
        await expect(service.findEvaluationsByAgent(USER_B, AGENT_ID)).resolves.toEqual([]);
        expect(evaluations.appendRunResults).not.toHaveBeenCalled();
        expect(evaluations.finalize).not.toHaveBeenCalled();
        expect(evaluations.deleteById).not.toHaveBeenCalled();
    });

    it('refuses to run someone else\'s evaluation before calling the ADK', async () => {
        const { service } = setup();
        // USER_B manages the same agent, but the run belongs to USER_A.
        await expect(service.runSingleEvaluation(USER_B, [], AGENT_ID, DATASET_A, 'strict', 's', EVALUATION_A, 1, 'Bearer x'))
            .rejects.toThrow(NotFoundException);
        expect(axiosPost).not.toHaveBeenCalled();
    });

    it('refuses to run an evaluation against a dataset it was not created with, even the caller\'s own', async () => {
        const { service } = setup();
        await expect(service.runSingleEvaluation(USER_A, [], AGENT_ID, DATASET_B, 'strict', 's', EVALUATION_A, 1, 'Bearer x'))
            .rejects.toThrow(ForbiddenException);
        expect(axiosPost).not.toHaveBeenCalled();
    });

    it('runs an own evaluation against its own dataset, naming the actor to the ADK', async () => {
        const { service, evaluations } = setup();
        const stream = new EventEmitter();
        axiosPost.mockResolvedValueOnce({ data: stream });
        const done = service.runSingleEvaluation(USER_A, [], AGENT_ID, DATASET_A, 'strict', 's', EVALUATION_A, 1, 'Bearer secret');
        // Let the service reach its stream listener before the stream ends.
        const tick = () => new Promise((resolve) => setImmediate(resolve));
        await tick();
        await tick();
        stream.emit('data', Buffer.from('data: ' + JSON.stringify({
            type: 'progress',
            test_case: { test_number: 1, question: 'q', reference_answer: 'r', agent_answer: 'a' },
        }) + '\n\n'));
        stream.emit('end');
        await expect(done).resolves.toMatchObject({ results: [{ question: 'q' }], runIndex: 1 });
        const [url, body, config] = axiosPost.mock.calls[0];
        expect(String(url)).toContain('/evaluation-batch/execute_agent_evaluator');
        expect(config.headers['x-api-key']).toBeDefined();
        expect(config.headers['X-YellowStorm-User-Id']).toBe(USER_A);
        expect(JSON.stringify(body)).not.toContain('Bearer secret');
        expect(evaluations.appendRunResults).toHaveBeenCalledWith(EVALUATION_A, USER_A, expect.any(Array));
    });
});

describe('ScenarioService dataset ownership', () => {
    const setup = () => {
    const scenarios = {
        create: jest.fn(async () => ({ id: 'sc1' })),
        update: jest.fn(async () => ({ id: 'sc1' })),
        findById: jest.fn(async () => null),
        findByAgent: jest.fn(async () => []),
        deleteById: jest.fn(async () => undefined),
    };
    const datasets = {
            findByIdForCreator: jest.fn(async (id: string, userId: string) =>
                id === DATASET_A && userId === USER_A ? datasetRow(id, USER_A) : null),
        };
        const agentService = { findUserAgentById: jest.fn(async () => ({ id: AGENT_ID })), canWriteAgent: jest.fn(async () => true) };
        const logger = { setContext: jest.fn(), error: jest.fn() };
        const service = new ScenarioService(scenarios as never, datasets as never, logger as never, agentService as never);
        return { service, scenarios, datasets };
    };

    it('creates a scenario only on a dataset the creator owns', async () => {
        const { service, scenarios } = setup();
        await expect(service.create(USER_A, [], { name: 's', agentId: AGENT_ID, datasetId: DATASET_A } as never)).resolves.toMatchObject({ id: 'sc1' });
        await expect(service.create(USER_B, [], { name: 's', agentId: AGENT_ID, datasetId: DATASET_A } as never)).rejects.toThrow(NotFoundException);
        expect(scenarios.create).toHaveBeenCalledTimes(1);
    });

    it('refuses re-pointing a scenario at a foreign dataset', async () => {
        const { service, scenarios } = setup();
        const existing = { id: 'sc1', agentId: AGENT_ID, datasetId: DATASET_A };
        (scenarios.findById as jest.Mock).mockResolvedValueOnce(existing);
        await expect(service.update(USER_A, [], 'sc1', { datasetId: DATASET_B } as never)).rejects.toThrow(NotFoundException);
        expect(scenarios.update).not.toHaveBeenCalled();
    });
});
