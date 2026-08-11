import { PartialType } from '@nestjs/swagger';
import { CreatePlaybookNodeTemplateDto } from './create-playbook-node-template.dto';

export class UpdatePlaybookNodeTemplateDto extends PartialType(CreatePlaybookNodeTemplateDto) {}
