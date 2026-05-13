import { ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';
import { CreatePlaybookFlowDto } from './create-playbook-flow.dto';

export class UpdatePlaybookFlowDto extends PartialType(CreatePlaybookFlowDto) {}
