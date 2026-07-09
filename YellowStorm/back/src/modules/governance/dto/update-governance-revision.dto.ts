import { PartialType } from '@nestjs/swagger';
import { CreateGovernanceRevisionDto } from './create-governance-revision.dto';

export class UpdateGovernanceRevisionDto extends PartialType(CreateGovernanceRevisionDto) {}
