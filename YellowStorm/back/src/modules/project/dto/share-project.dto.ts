import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  ValidateNested,
} from 'class-validator';
import type { ProjectPermission } from '../interfaces/project.interface';

export class ShareProjectEntryDto {
  @ApiProperty({ description: 'Email of the user to share with', example: 'teammate@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'Permission to grant', enum: ['read', 'readwrite'], example: 'read' })
  @IsEnum(['read', 'readwrite'])
  permission!: ProjectPermission;
}

export class ShareProjectDto {
  @ApiProperty({ type: [ShareProjectEntryDto], description: 'List of users to share with' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ShareProjectEntryDto)
  shares!: ShareProjectEntryDto[];
}
