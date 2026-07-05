import { PartialType } from '@nestjs/swagger';
import { CreateGovernanceSourceDto } from './create-governance-source.dto';

export class UpdateGovernanceSourceDto extends PartialType(CreateGovernanceSourceDto) {}
