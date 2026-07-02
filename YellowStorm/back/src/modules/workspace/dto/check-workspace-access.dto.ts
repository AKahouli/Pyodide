import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

/**
 * Query params for the external workspace access-check endpoint.
 */
export class CheckWorkspaceAccessDto {
  @ApiProperty({
    description: 'ID of the user whose access is being checked',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId()
  userId!: string;

  @ApiProperty({
    description: 'ID of the workspace to check access against',
    example: '507f191e810c19729de860ea',
  })
  @IsMongoId()
  workspaceId!: string;
}
