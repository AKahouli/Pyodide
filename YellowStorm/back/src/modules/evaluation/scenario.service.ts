import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Schema as MongooseSchema } from 'mongoose';
import { Scenario, ScenarioDocument } from './schemas/scenario.schema';
import { LoggerService } from '../logger';

@Injectable()
export class ScenarioService {
    constructor(
        @InjectModel(Scenario.name) private scenarioModel: Model<ScenarioDocument>,
        private readonly logger: LoggerService,
    ) {
        this.logger.setContext(ScenarioService.name);
    }

    async create(data: Partial<Scenario>): Promise<ScenarioDocument> {
        try {
            // Remove 'id' if present to avoid Mongoose conflicts during create
            const { id, ...cleanData } = data as any;
            const created = new this.scenarioModel(cleanData);
            return await created.save();
        } catch (error: any) {
            this.logger.error(`Failed to create scenario: ${error.message}`, error.stack);
            throw new InternalServerErrorException(`Failed to create scenario: ${error.message}`);
        }
    }

    async findAllByAgent(agentId: string): Promise<ScenarioDocument[]> {
        return this.scenarioModel.find({ agentId }).exec();
    }

    async findOne(id: string): Promise<ScenarioDocument> {
        const scenario = await this.scenarioModel.findById(id).exec();
        if (!scenario) {
            throw new NotFoundException(`Scenario with ID ${id} not found`);
        }
        return scenario;
    }

    async update(id: string, data: Partial<Scenario>): Promise<ScenarioDocument> {
        try {
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
            this.logger.error(`Failed to update scenario ${id}: ${error.message}`, error.stack);
            throw new InternalServerErrorException(`Failed to update scenario: ${error.message}`);
        }
    }

    async remove(id: string): Promise<void> {
        const result = await this.scenarioModel.findByIdAndDelete(id).exec();
        if (!result) {
            throw new NotFoundException(`Scenario with ID ${id} not found`);
        }
    }
}
