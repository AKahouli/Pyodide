import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ConversationOwnerGuard } from '../guards/conversation-owner.guard';
import { RootResultService } from '../root-work/root-result.service';
import { RootEvidenceService } from '../root-work/root-evidence.service';

@ApiTags('Conversations')
@ApiBearerAuth()
@Controller('conversations/:id/root-results')
@UseGuards(ConversationOwnerGuard)
export class RootResultController {
  constructor(private readonly results: RootResultService, private readonly evidence: RootEvidenceService) {}

  @Get(':executionId/evidence/:evidenceId')
  resolveEvidence(@Param('id') id: string, @Param('executionId') executionId: string,
    @Param('evidenceId') evidenceId: string, @CurrentUser() user: { _id: string }) {
    return this.evidence.resolve(id, executionId, evidenceId, user._id.toString());
  }

  @Get(':executionId')
  getResult(@Param('id') id: string, @Param('executionId') executionId: string,
    @CurrentUser() user: { _id: string }) {
    return this.results.getResult(id, executionId, user._id.toString());
  }
}
