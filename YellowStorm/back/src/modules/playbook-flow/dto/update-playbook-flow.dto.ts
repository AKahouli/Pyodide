import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, ValidateNested, ArrayMaxSize } from 'class-validator';
import { CreatePlaybookFlowDto } from './create-playbook-flow.dto';
import { ControlEdgeDto } from './playbook-flow-control-edge.dto';

export class UpdatePlaybookFlowDto extends PartialType(CreatePlaybookFlowDto) {
  @ApiPropertyOptional({ type: [ControlEdgeDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ControlEdgeDto)
  controlEdges?: ControlEdgeDto[];
}
