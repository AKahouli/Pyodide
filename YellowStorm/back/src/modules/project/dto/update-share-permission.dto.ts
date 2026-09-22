import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import type { ProjectPermission } from '../interfaces/project.interface';

export class UpdateSharePermissionDto {
  @ApiProperty({ description: 'New permission for the shared user', enum: ['read', 'readwrite'] })
  @IsEnum(['read', 'readwrite'])
  permission!: ProjectPermission;
}
