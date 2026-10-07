import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** Admin > Semantic models: who may use the semantic model tools of an agent. */
export class AssistantAccessDto {
  @ApiProperty({ default: true, description: 'The person an agent acts for needs the semantic_models permissions' })
  @IsBoolean()
  enforcePermissions!: boolean;
}
