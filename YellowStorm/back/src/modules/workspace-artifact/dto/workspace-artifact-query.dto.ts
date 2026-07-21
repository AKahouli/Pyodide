import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsOptional, IsString } from 'class-validator';
import { WorkspaceArtifactStatus } from '../interfaces/workspace-artifact.interface';

export class WorkspaceArtifactQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsIn(['decision_flow']) type?: 'decision_flow';
  @ApiPropertyOptional() @IsOptional() @IsMongoId() sourceDocumentId?: string;
  @ApiPropertyOptional({ enum: WorkspaceArtifactStatus }) @IsOptional() @IsIn(Object.values(WorkspaceArtifactStatus)) status?: WorkspaceArtifactStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
}
