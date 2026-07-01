import {
  Controller,
  Get,
  Delete,
  Query,
  Body,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { MemoryCardsService } from './memory-cards.service';
import { DeleteMemoryCardsDto } from './dto/delete-memory-cards.dto';
import { MemoryCardResponse } from './interfaces/memory-card.interface';
import { AgentService } from '../agent/agent.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../user/schemas/user.schema';

@ApiTags('Memory Cards')
@ApiBearerAuth()
@Controller('memory-cards')
export class MemoryCardsController {
  constructor(
    private readonly memoryCardsService: MemoryCardsService,
    private readonly agentService: AgentService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List an agent's memory cards" })
  @ApiQuery({ name: 'agentId', required: true })
  @ApiResponse({ status: 200, description: 'Memory cards retrieved' })
  async list(
    @Query('agentId') agentId: string,
  ): Promise<{ memories: MemoryCardResponse[]; total: number }> {
    if (!agentId) {
      throw new BadRequestException('agentId is required');
    }
    const memories = await this.memoryCardsService.findByAgent(agentId);
    return { memories, total: memories.length };
  }

  @Delete()
  @ApiOperation({ summary: "Delete selected memory cards of an agent" })
  @ApiQuery({ name: 'agentId', required: true })
  @ApiResponse({ status: 200, description: 'Memory cards deleted' })
  async remove(
    @Query('agentId') agentId: string,
    @Body() dto: DeleteMemoryCardsDto,
    @CurrentUser() user: UserDocument,
  ): Promise<{ deleted: number }> {
    if (!agentId) {
      throw new BadRequestException('agentId is required');
    }
    // Read-only recipients (and non-owners of default agents) can view memories
    // but must not delete them.
    const canWrite = await this.agentService.canWriteAgent(user._id.toString(), agentId);
    if (!canWrite) {
      throw new ForbiddenException('You do not have permission to delete this agent memories');
    }
    const deleted = await this.memoryCardsService.deleteMany(agentId, dto.ids);
    return { deleted };
  }
}
