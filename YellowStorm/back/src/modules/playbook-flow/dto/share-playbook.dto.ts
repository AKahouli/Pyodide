import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsEmail, IsIn } from 'class-validator';
import type { AssignablePlaybookPermission } from '../interfaces/playbook-share.interface';

export class SharePlaybookDto {
  @ApiProperty({ type: [String], description: 'Recipient email addresses' })
  @IsArray()
  @ArrayNotEmpty()
  @IsEmail({}, { each: true })
  emails!: string[];

  @ApiProperty({ enum: ['read', 'write'] })
  @IsIn(['read', 'write'])
  permission!: AssignablePlaybookPermission;
}

export class UpdatePlaybookSharePermissionDto {
  @ApiProperty({ enum: ['read', 'write'] })
  @IsIn(['read', 'write'])
  permission!: AssignablePlaybookPermission;
}
