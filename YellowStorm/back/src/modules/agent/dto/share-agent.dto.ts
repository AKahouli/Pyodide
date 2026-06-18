import { IsArray, ArrayMinSize, IsEmail, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ShareAgentDto {
  @ApiProperty({
    description: 'Email addresses of users to share the agent with',
    example: ['user@example.com'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsEmail({}, { each: true })
  emails!: string[];

  @ApiProperty({
    description: 'Permission level for the shared users',
    enum: ['read', 'write'],
    example: 'read',
  })
  @IsIn(['read', 'write'])
  permission!: 'read' | 'write';
}

export class UpdateAgentSharePermissionDto {
  @ApiProperty({
    description: 'New permission level',
    enum: ['read', 'write'],
    example: 'write',
  })
  @IsIn(['read', 'write'])
  permission!: 'read' | 'write';
}
