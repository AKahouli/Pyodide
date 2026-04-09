import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards } from '@nestjs/common';
import { ScenarioService } from './scenario.service';
import { Scenario } from './schemas/scenario.schema';

@Controller('evaluation/scenarios')
export class ScenarioController {
    constructor(private readonly scenarioService: ScenarioService) { }

    @Post()
    async create(@Body() data: any) {
        return this.scenarioService.create(data);
    }

    @Get('agent/:agentId')
    async findAllByAgent(@Param('agentId') agentId: string) {
        return this.scenarioService.findAllByAgent(agentId);
    }

    @Get(':id')
    async findOne(@Param('id') id: string) {
        return this.scenarioService.findOne(id);
    }

    @Put(':id')
    async update(@Param('id') id: string, @Body() data: any) {
        return this.scenarioService.update(id, data);
    }

    @Delete(':id')
    async remove(@Param('id') id: string) {
        return this.scenarioService.remove(id);
    }
}
