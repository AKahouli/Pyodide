import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { UserDocument } from '@modules/user/schemas/user.schema';
import { Permissions, PermissionsGuard, RequirePermissions } from '@modules/authorization';
import { SemanticDataTokenService } from '../services/semantic-data-token.service';

@ApiTags('Semantic Models')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('semantic-models')
export class SemanticDataTokenController {
  constructor(private readonly tokens: SemanticDataTokenService) {}

  @Get(':modelId/data-token')
  @ApiOperation({ summary: 'Mint short-lived model-scoped data-plane tokens' })
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ, Permissions.SEMANTIC_MODELS_ALL], 'any')
  dataToken(@CurrentUser() user: UserDocument, @Param('modelId') modelId: string) {
    return this.tokens.issue(user._id.toString(), modelId);
  }
}
