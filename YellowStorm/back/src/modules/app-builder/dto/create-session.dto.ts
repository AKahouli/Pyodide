import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
} from 'class-validator';

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

  @ApiPropertyOptional({
    description:
      'Published app template to seed the session revision from. When set, the browser runtime boots on the template manifest.',
  })
  @IsOptional()
  @IsMongoId()
  templateId?: string;

  @ApiPropertyOptional({
    description:
      'OpenCode session capability. `web_app` (default) builds a Vite app; `database_design` drives the schema designer.',
    enum: ['web_app', 'database_design'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['web_app', 'database_design'])
  capability?: 'web_app' | 'database_design';
}
