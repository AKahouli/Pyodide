import { PartialType } from '@nestjs/swagger';
import { CreateGovernanceMembershipDto } from './create-governance-membership.dto';

export class UpdateGovernanceMembershipDto extends PartialType(CreateGovernanceMembershipDto) {}
