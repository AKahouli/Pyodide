import { ForbiddenException, HttpException, Inject, Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { LoggerService } from '../logger';
import { AgentService } from '../agent/agent.service';
import { BadRequestException } from '../exceptions/exceptions/http.exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import type { ScenarioInput, ScenarioRecord } from './evaluation.types';
import { EVALUATION_SCENARIO_STORE, type EvaluationScenarioStore } from './persistence/evaluation-scenario.store';

@Injectable()
export class ScenarioService {
    constructor(
        @Inject(EVALUATION_SCENARIO_STORE) private readonly scenarios: EvaluationScenarioStore,
        private readonly logger: LoggerService,
        private readonly agentService: AgentService,
    ) {
        this.logger.setContext(ScenarioService.name);
    }

    async create(userId: string, permissions: string[], data: ScenarioInput): Promise<ScenarioRecord> {
        try {
            if (!data.agentId) {
                throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
            }
            await this.assertCanManageAgent(userId, permissions, data.agentId.toString());
            const input = this.parseInput(data);
            if (!input.name) throw new BadRequestException('Scenario name is required');
            if (!input.agentId) throw new BadRequestException('Scenario agentId is required');
            if (!input.datasetId) throw new BadRequestException('Scenario datasetId is required');
            return await this.scenarios.create({
                name: input.name,
                agentId: input.agentId,
                datasetId: input.datasetId,
                numRuns: input.numRuns,
                mode: input.mode,
            });
        } catch (error: any) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to create scenario: ${error.message}`, error.stack);
            throw new InternalServerErrorException(`Failed to create scenario: ${error.message}`);
        }
    }

    async findAllByAgent(userId: string, agentId: string): Promise<ScenarioRecord[]> {
        await this.agentService.findUserAgentById(userId, agentId);
        return this.scenarios.findByAgent(agentId);
    }

    async findOne(userId: string, id: string): Promise<ScenarioRecord> {
        const scenario = await this.scenarios.findById(id);
        if (!scenario) {
            throw new NotFoundException(`Scenario with ID ${id} not found`);
        }
        await this.agentService.findUserAgentById(userId, scenario.agentId);
        return scenario;
    }

    async update(userId: string, permissions: string[], id: string, data: ScenarioInput): Promise<ScenarioRecord> {
        try {
            const existing = await this.scenarios.findById(id);
            if (!existing) {
                throw new NotFoundException(`Scenario with ID ${id} not found`);
            }
            await this.assertCanManageAgent(userId, permissions, existing.agentId);
            if (data.agentId && data.agentId.toString().toLowerCase() !== existing.agentId) {
                await this.assertCanManageAgent(userId, permissions, data.agentId.toString());
            }
            const updated = await this.scenarios.update(id, this.parseInput(data));
            if (!updated) {
                throw new NotFoundException(`Scenario with ID ${id} not found`);
            }
            return updated;
        } catch (error: any) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to update scenario ${id}: ${error.message}`, error.stack);
            throw new InternalServerErrorException(`Failed to update scenario: ${error.message}`);
        }
    }

    async remove(userId: string, permissions: string[], id: string): Promise<void> {
        const scenario = await this.scenarios.findById(id);
        if (!scenario) {
            throw new NotFoundException(`Scenario with ID ${id} not found`);
        }
        await this.assertCanManageAgent(userId, permissions, scenario.agentId);
        await this.scenarios.deleteById(id);
    }

    /**
     * Keeps only the fields a client may set (the former Mongoose strict schema dropped the rest,
     * including `id`) and rejects malformed values, which used to surface as a Mongoose cast error.
     */
    private parseInput(data: ScenarioInput): ScenarioInput {
        const out: ScenarioInput = {};
        if (data.name !== undefined) {
            const name = typeof data.name === 'string' ? data.name.trim() : '';
            if (!name) throw new BadRequestException('Scenario name cannot be empty');
            out.name = name;
        }
        for (const key of ['agentId', 'datasetId'] as const) {
            const value = data[key];
            if (value === undefined) continue;
            const id = String(value);
            if (!isObjectId(id)) throw new BadRequestException(`Scenario ${key} is not a valid id`);
            out[key] = id.toLowerCase();
        }
        if (data.numRuns !== undefined) {
            const numRuns = Math.trunc(Number(data.numRuns));
            if (!Number.isFinite(numRuns) || numRuns < 1) throw new BadRequestException('Scenario numRuns must be at least 1');
            out.numRuns = numRuns;
        }
        if (data.mode !== undefined) {
            if (data.mode !== 'strict' && data.mode !== 'non_strict') {
                throw new BadRequestException(`Invalid scenario mode "${String(data.mode)}"`);
            }
            out.mode = data.mode;
        }
        return out;
    }

    private async assertCanManageAgent(userId: string, permissions: string[], agentId: string) {
        const agent = await this.agentService.findUserAgentById(userId, agentId);
        if (agent.isDefault) {
            if (!this.hasAgentManagerPermission(permissions)) {
                throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_DEFAULT_READONLY);
            }
            return;
        }
        const canWrite = await this.agentService.canWriteAgent(userId, agentId);
        if (!canWrite) {
            throw new ForbiddenException(ErrorCode.CUSTOM_AGENT_SHARE_FORBIDDEN);
        }
    }

    private hasAgentManagerPermission(permissions: string[]): boolean {
        return permissions.some(
            (permission) => permission === '*' || permission === 'agents.*' || permission === 'agents.update',
        );
    }
}
