import { ForbiddenException, HttpException, Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Schema as MongooseSchema } from 'mongoose';
import { Scenario, ScenarioDocument } from './schemas/scenario.schema';
import { LoggerService } from '../logger';
import { AgentService } from '../agent/agent.service';
import { ErrorCode } from '../exceptions/constants/error-codes';

@Injectable()
export class ScenarioService {
    constructor(
        @InjectModel(Scenario.name) private scenarioModel: Model<ScenarioDocument>,
        private readonly logger: LoggerService,
        private readonly agentService: AgentService,
    ) {
        this.logger.setContext(ScenarioService.name);
    }

    async create(userId: string, permissions: string[], data: Partial<Scenario>): Promise<ScenarioDocument> {
        try {
            if (!data.agentId) {
                throw new NotFoundException(ErrorCode.CUSTOM_AGENT_NOT_FOUND);
            }
            await this.assertCanManageAgent(userId, permissions, data.agentId.toString());
            // Remove 'id' if present to avoid Mongoose conflicts during create
            const { id, ...cleanData } = data as any;
            const created = new this.scenarioModel(cleanData);
            return await created.save();
        } catch (error: any) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Failed to create scenario: ${error.message}`, error.stack);
            throw new InternalServerErrorException(`Failed to create scenario: ${error.message}`);
        }
    }

    async findAllByAgent(userId: string, agentId: string): Promise<ScenarioDocument[]> {
        await this.agentService.findUserAgentById(userId, agentId);
        return this.scenarioModel.find({ agentId }).exec();
    }

    async findOne(userId: string, id: string): Promise<ScenarioDocument> {
        const scenario = await this.scenarioModel.findById(id).exec();
        if (!scenario) {
            throw new NotFoundException(`Scenario with ID ${id} not found`);
        }
        await this.agentService.findUserAgentById(userId, scenario.agentId.toString());
        return scenario;
    }

    async update(userId: string, permissions: string[], id: string, data: Partial<Scenario>): Promise<ScenarioDocument> {
        try {
            const existing = await this.scenarioModel.findById(id).exec();
            if (!existing) {
                throw new NotFoundException(`Scenario with ID ${id} not found`);
            }
            await this.assertCanManageAgent(userId, permissions, existing.agentId.toString());
            if (data.agentId && data.agentId.toString() !== existing.agentId.toString()) {
                await this.assertCanManageAgent(userId, permissions, data.agentId.toString());
            }
            // Remove 'id' if present in body to avoid ID mutation error
            const { id: _, ...cleanData } = data as any;
            const updated = await this.scenarioModel
                .findByIdAndUpdate(id, cleanData, { new: true })
                .exec();
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
        const scenario = await this.scenarioModel.findById(id).exec();
        if (!scenario) {
            throw new NotFoundException(`Scenario with ID ${id} not found`);
        }
        await this.assertCanManageAgent(userId, permissions, scenario.agentId.toString());
        await this.scenarioModel.findByIdAndDelete(id).exec();
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
