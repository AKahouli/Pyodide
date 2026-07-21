import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional } from 'class-validator';

export class UpdateWorkspaceEvidenceSearchSettingsDto {
  @ApiPropertyOptional({ nullable: true, description: 'Active connector selected for global workspace evidence search.' })
  @IsOptional() @IsMongoId()
  connectorId?: string | null;
}
