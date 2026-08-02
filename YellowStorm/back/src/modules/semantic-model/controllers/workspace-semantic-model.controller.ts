import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { UserDocument } from '@modules/user/schemas/user.schema';
import { Permissions, PermissionsGuard, RequirePermissions } from '@modules/authorization';
import { SemanticModelRepository } from '../repositories/semantic-model.repository';
import { SemanticModelService } from '../services/semantic-model.service';

@ApiTags('Workspace Semantic Models')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('workspaces/:workspaceId')
export class WorkspaceSemanticModelController {
  constructor(private readonly models: SemanticModelService,private readonly repository: SemanticModelRepository) {}

  @Get('semantic-model')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  getDefault(@CurrentUser() user: UserDocument,@Param('workspaceId') workspaceId: string) {
    return this.repository.findByOriginWorkspace(workspaceId,user._id.toString());
  }

  @Get('semantic-models')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_READ,Permissions.SEMANTIC_MODELS_ALL],'any')
  list(@CurrentUser() user: UserDocument,@Param('workspaceId') workspaceId: string) {
    return this.repository.listByWorkspace(workspaceId,user._id.toString());
  }

  @Post('semantic-model/ensure')
  @RequirePermissions([Permissions.SEMANTIC_MODELS_CREATE,Permissions.SEMANTIC_MODELS_ALL],'any')
  ensure(@CurrentUser() user: UserDocument,@Param('workspaceId') workspaceId: string) {
    return this.models.ensureWorkspaceDefault(user._id.toString(),workspaceId);
  }
}
