import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ModelCheck, ModelCheckIssue, ModelCheckSeverity } from '../domain/semantic-model-check';

/** One thing the model check found: what is wrong, and which concept, field, link, source mapping or derived source it concerns. */
export class ModelCheckIssueDto implements ModelCheckIssue {
  @ApiProperty({ enum: ['error', 'warning'], description: 'Errors stop a preview, build or publish; warnings do not' })
  severity!: ModelCheckSeverity;

  @ApiProperty({ description: 'Stable code the front end translates' })
  code!: string;

  @ApiPropertyOptional({ description: 'Refines the code' })
  reason?: string;

  @ApiProperty({ description: 'English text, for a code with no translation' })
  message!: string;

  @ApiPropertyOptional() conceptId?: string;
  @ApiPropertyOptional({ description: 'The concept\'s field (its attribute key)' }) fieldId?: string;
  @ApiPropertyOptional() relationId?: string;
  @ApiPropertyOptional() mappingId?: string;
  @ApiPropertyOptional({ description: 'A derived source' }) sourceId?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: { oneOf: [{ type: 'string' }, { type: 'number' }] } })
  params?: Record<string, string | number>;
}

export class ModelCheckDto implements ModelCheck {
  @ApiProperty() modelId!: string;
  @ApiProperty({ description: 'Identifies what was checked: equal keys, equal answers' }) versionKey!: string;
  @ApiProperty() checkedAt!: string;
  @ApiProperty() errorCount!: number;
  @ApiProperty() warningCount!: number;
  @ApiProperty({ type: [ModelCheckIssueDto] }) issues!: ModelCheckIssueDto[];
}
