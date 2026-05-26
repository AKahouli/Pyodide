import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsMongoId, IsOptional } from 'class-validator';

export class CreateSessionDto {
  @ApiPropertyOptional({
    description:
      'Workspace ObjectIds the user wants to attach to this session. Validated against ownership / share access before being forwarded to the AI service.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsMongoId({ each: true })
  workspaceIds?: string[];
}
