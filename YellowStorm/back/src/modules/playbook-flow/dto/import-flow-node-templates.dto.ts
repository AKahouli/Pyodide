import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsOptional, ValidateNested } from 'class-validator';
import { CreateFlowNodeTemplateDto } from './create-flow-node-template.dto';

class ImportFlowNodeTemplateItemDto extends CreateFlowNodeTemplateDto {
  @IsOptional()
  @IsBoolean()
  isBuiltIn?: boolean;
}

export class ImportFlowNodeTemplatesDto {
  @ApiProperty({ enum: [1] })
  @IsIn([1])
  version!: 1;

  @ApiProperty({ enum: ['playbook-node-templates'] })
  @IsIn(['playbook-node-templates'])
  type!: 'playbook-node-templates';

  @ApiProperty({ type: [ImportFlowNodeTemplateItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportFlowNodeTemplateItemDto)
  items!: ImportFlowNodeTemplateItemDto[];
}
