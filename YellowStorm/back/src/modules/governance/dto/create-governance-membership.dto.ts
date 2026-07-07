import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsOptional } from 'class-validator';

export class CreateGovernanceMembershipDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  scopeId?: string;

  @ApiProperty()
  @IsOptional()
  @IsMongoId()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  groupId?: string;

  @ApiProperty({ enum: ['program_owner', 'program_admin', 'scope_admin', 'scope_approver', 'scope_editor', 'scope_reviewer', 'scope_viewer'] })
  @IsIn(['program_owner', 'program_admin', 'scope_admin', 'scope_approver', 'scope_editor', 'scope_reviewer', 'scope_viewer'])
  role!: string;

  @ApiPropertyOptional({ enum: ['invited', 'active', 'disabled'] })
  @IsOptional()
  @IsIn(['invited', 'active', 'disabled'])
  status?: 'invited' | 'active' | 'disabled';
}
