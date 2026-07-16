import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional } from 'class-validator';

export class UpdateWorkspaceTransformationSettingsDto {
  @ApiPropertyOptional({ nullable: true, description: 'Active default agent used to generate Workspace decision flows.' })
  @IsOptional()
  @IsMongoId()
  decisionFlowAgentId?: string | null;
}
