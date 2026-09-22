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
import type { AuthUser } from '@common/auth/auth-user';

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
  @ApiQuery({ name: 'page', required: false, description: 'Page number (1-based)' })
  @ApiQuery({ name: 'pageSize', required: false, description: 'Rows per page (10, 20, 30 or 50)' })
  @ApiQuery({ name: 'search', required: false, description: 'Full-text search across all fields except id' })
  @ApiResponse({ status: 200, description: 'Memory cards retrieved' })
  async list(
    @Query('agentId') agentId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ): Promise<{ memories: MemoryCardResponse[]; total: number }> {
    if (!agentId) {
      throw new BadRequestException('agentId is required');
    }
    // Clamp pageSize to the allowed choices (default 10) and page to >= 1.
    const allowedPageSizes = [10, 20, 30, 50];
    const parsedPageSize = Number(pageSize);
    const limit = allowedPageSizes.includes(parsedPageSize) ? parsedPageSize : 10;
    const parsedPage = Number(page);
    const currentPage = Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
    const offset = (currentPage - 1) * limit;

    return this.memoryCardsService.findByAgent(agentId, {
      search: search?.trim() || undefined,
      limit,
      offset,
    });
  }

  @Delete()
  @ApiOperation({ summary: "Delete selected memory cards of an agent" })
  @ApiQuery({ name: 'agentId', required: true })
  @ApiResponse({ status: 200, description: 'Memory cards deleted' })
  async remove(
    @Query('agentId') agentId: string,
    @Body() dto: DeleteMemoryCardsDto,
    @CurrentUser() user: AuthUser,
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
