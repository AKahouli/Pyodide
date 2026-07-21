import { Controller, Get, Post, Body, Param, Put, Delete } from '@nestjs/common';
import { ScenarioService } from './scenario.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../user/schemas/user.schema';

@Controller('evaluation/scenarios')
export class ScenarioController {
    constructor(private readonly scenarioService: ScenarioService) { }

    @Post()
    async create(@CurrentUser() user: UserDocument, @Body() data: any) {
        return this.scenarioService.create(user._id.toString(), this.permissionsOf(user), data);
    }

    @Get('agent/:agentId')
    async findAllByAgent(@CurrentUser() user: UserDocument, @Param('agentId') agentId: string) {
        return this.scenarioService.findAllByAgent(user._id.toString(), agentId);
    }

    @Get(':id')
    async findOne(@CurrentUser() user: UserDocument, @Param('id') id: string) {
        return this.scenarioService.findOne(user._id.toString(), id);
    }

    @Put(':id')
    async update(@CurrentUser() user: UserDocument, @Param('id') id: string, @Body() data: any) {
        return this.scenarioService.update(user._id.toString(), this.permissionsOf(user), id, data);
    }

    @Delete(':id')
    async remove(@CurrentUser() user: UserDocument, @Param('id') id: string) {
        return this.scenarioService.remove(user._id.toString(), this.permissionsOf(user), id);
    }

    private permissionsOf(user: UserDocument): string[] {
        return (user as unknown as { permissions?: string[] }).permissions ?? [];
    }
}
