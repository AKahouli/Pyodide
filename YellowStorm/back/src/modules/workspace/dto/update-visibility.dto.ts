import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateVisibilityDto {
  @ApiProperty({ description: 'Whether the workspace is public (readable by all logged-in users)' })
  @IsBoolean()
  isPublic!: boolean;
}
