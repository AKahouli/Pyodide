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

  @ApiPropertyOptional({
    description:
      'Published app template to seed the session revision from. When set, the browser runtime boots on the template manifest.',
  })
  @IsOptional()
  @IsMongoId()
  templateId?: string;

  @ApiPropertyOptional({
    description:
      'Super-admin only: ephemeral template id from POST …/templates/staging/publish. Seeds the session from that Ceph manifest without a catalog row.',
  })
  @IsOptional()
  @IsMongoId()
  stagingTemplateId?: string;
}
