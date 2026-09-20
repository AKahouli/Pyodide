import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { UpdateGovernanceScopeAudienceDto } from '../dto';
import { GovernanceScopeAudienceResponse, GovernanceScopeAudienceService } from '../services/governance-scope-audience.service';

@ApiTags('Governance')
@ApiBearerAuth()
@Controller('governance/programs/:programId/scopes/:scopeId/audience')
export class GovernanceScopeAudienceController {
  constructor(private readonly audienceService: GovernanceScopeAudienceService) {}

  @Get()
  @ApiOperation({ summary: 'Get the authenticated-user audience for a governance scope' })
  getAudience(@CurrentUser() user: AuthUser, @Param('programId') programId: string, @Param('scopeId') scopeId: string): Promise<GovernanceScopeAudienceResponse> {
    return this.audienceService.getAudience(user._id.toString(), programId, scopeId);
  }

  @Patch()
  @ApiOperation({ summary: 'Update the authenticated-user audience for a governance scope' })
  updateAudience(@CurrentUser() user: AuthUser, @Param('programId') programId: string, @Param('scopeId') scopeId: string, @Body() dto: UpdateGovernanceScopeAudienceDto): Promise<GovernanceScopeAudienceResponse> {
    return this.audienceService.updateAudience(user._id.toString(), user.email, programId, scopeId, dto);
  }
}
