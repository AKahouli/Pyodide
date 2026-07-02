import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { WorkyMemoryService, IWorkyMemoryEntryResponse, IWorkyMemoryProposalResponse } from '../services/worky-memory.service';
import { RequirePermissions } from '../../authorization/decorators/require-permissions.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';
import { Permissions } from '../../authorization/constants/permissions';

class RejectMemoryDto {
  @ApiPropertyOptional({ description: 'Optional reason for rejecting the proposal' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/**
 * Owner-scoped memory (Part 4 §7, canonical §21). Confirm-before-write
 * semantics: the memory service only persists a `WorkyMemoryEntry`
 * when the owner explicitly calls `confirm`; rejected proposals
 * write nothing.
 */
@ApiTags('Worky')
@ApiBearerAuth()
@Controller('worky/memory')
export class WorkyMemoryController {
  constructor(private readonly memory: WorkyMemoryService) {}

  @Get('proposals')
  @RequirePermissions(Permissions.WORKY_STREAM_READ)
  @ApiOperation({ summary: 'List memory proposals for the current owner' })
  async listProposals(
    @CurrentUser() user: UserDocument,
    @Query('status') status?: 'pending' | 'confirmed' | 'rejected',
  ): Promise<IWorkyMemoryProposalResponse[]> {
    return this.memory.findProposals(user._id.toString(), status);
  }

  @Get('entries')
  @RequirePermissions(Permissions.WORKY_STREAM_READ)
  @ApiOperation({ summary: 'List confirmed memory entries for the current owner' })
  async listEntries(
    @CurrentUser() user: UserDocument,
  ): Promise<IWorkyMemoryEntryResponse[]> {
    return this.memory.findForOwner(user._id.toString());
  }

  @Post('proposals/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Confirm a pending memory proposal (writes the durable entry)' })
  async confirm(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
  ): Promise<IWorkyMemoryEntryResponse> {
    return this.memory.confirm({ proposalId: id, actorUserId: user._id.toString() });
  }

  @Post('proposals/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Reject a pending memory proposal (writes nothing)' })
  async reject(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: RejectMemoryDto,
  ): Promise<IWorkyMemoryProposalResponse> {
    return this.memory.reject({
      proposalId: id,
      actorUserId: user._id.toString(),
      reason: dto.reason,
    });
  }
}
