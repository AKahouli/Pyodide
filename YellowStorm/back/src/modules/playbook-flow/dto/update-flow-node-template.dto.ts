import { PartialType } from '@nestjs/swagger';
import { CreateFlowNodeTemplateDto } from './create-flow-node-template.dto';

export class UpdateFlowNodeTemplateDto extends PartialType(CreateFlowNodeTemplateDto) {}
