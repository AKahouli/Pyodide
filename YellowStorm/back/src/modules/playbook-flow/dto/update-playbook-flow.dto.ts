import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, ValidateNested, ArrayMaxSize, IsString, MaxLength, IsInt, Min } from 'class-validator';
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

  @ApiPropertyOptional({ description: 'Reject the save if the stored playbook changed since this timestamp was read.' })
  @IsOptional()
  @IsString()
  expectedUpdatedAt?: string;

  @ApiPropertyOptional({ description: 'Reject the save if the stored playbook definition revision changed since it was read.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedDefinitionRevision?: number;

  @ApiPropertyOptional({ description: 'Stable client-side mutation key for suggestion-generated saves.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientMutationId?: string;
}
