import {
  Controller,
  Get,
  Delete,
  Query,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { MemoryCardsService } from './memory-cards.service';
import { DeleteMemoryCardsDto } from './dto/delete-memory-cards.dto';
import { MemoryCardResponse } from './interfaces/memory-card.interface';

@ApiTags('Memory Cards')
@ApiBearerAuth()
@Controller('memory-cards')
export class MemoryCardsController {
  constructor(private readonly memoryCardsService: MemoryCardsService) {}

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
  ): Promise<{ deleted: number }> {
    if (!agentId) {
      throw new BadRequestException('agentId is required');
    }
    const deleted = await this.memoryCardsService.deleteMany(agentId, dto.ids);
    return { deleted };
  }
}
