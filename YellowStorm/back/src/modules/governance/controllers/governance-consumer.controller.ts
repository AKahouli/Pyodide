import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { UserDocument } from '@modules/user/schemas/user.schema';
import { AvailableGovernedScope, GovernanceConsumerScopeService } from '../services/governance-consumer-scope.service';

@ApiTags('Governance consumer')
@ApiBearerAuth()
@Controller('governance/me')
export class GovernanceConsumerController {
  constructor(private readonly consumerScopeService: GovernanceConsumerScopeService) {}

  @Get('available-scopes')
  @ApiOperation({ summary: 'List published governed assistants available to the current user' })
  listAvailable(@CurrentUser() user: UserDocument): Promise<AvailableGovernedScope[]> {
    return this.consumerScopeService.listAvailable(user._id.toString());
  }
}
