import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { Permissions } from '@modules/authorization/constants/permissions';
import { RunSecondBrainTurnDto } from '../dto/playbook-assistant.dto';
import { MascotToolExecutionPolicyService } from '../assistant/mascot-tool-execution-policy.service';
import { SecondBrainService } from '../assistant/second-brain.service';

@ApiTags('My Second Brain')
@ApiBearerAuth()
@Controller('second-brain')
export class SecondBrainController {
  constructor(
    private readonly secondBrainService: SecondBrainService,
    private readonly policyService: MascotToolExecutionPolicyService,
  ) {}

  @Post('turns')
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  @ApiOperation({ summary: 'Run one authenticated My Second Brain turn' })
  runTurn(@CurrentUser('_id') userId: string, @Body() dto: RunSecondBrainTurnDto) {
    return this.secondBrainService.runTurn(userId, dto);
  }

  @Post('confirmations/:confirmationId/confirm')
  @RequirePermissions(Permissions.PLAYBOOK_EXECUTE)
  @ApiOperation({ summary: 'Confirm and resume a pending mascot tool call through the runtime pipeline' })
  async confirm(@CurrentUser('_id') userId: string, @Param('confirmationId') confirmationId: string) {
    const consumption = await this.policyService.confirm(userId, confirmationId);
    if (consumption.kind === 'replayed') return consumption.result;
    try {
      const result = await this.secondBrainService.continueConfirmed(userId, consumption.confirmation);
      await this.policyService.complete(
        userId,
        confirmationId,
        consumption.confirmation.continuationCorrelationId,
        result,
      );
      return result;
    } catch (error) {
      await this.policyService.fail(userId, confirmationId);
      throw error;
    }
  }

  @Post('confirmations/:confirmationId/reject')
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  @ApiOperation({ summary: 'Reject a pending mascot tool call' })
  async reject(@CurrentUser('_id') userId: string, @Param('confirmationId') confirmationId: string) {
    await this.policyService.reject(userId, confirmationId);
    return { rejected: true };
  }
}
