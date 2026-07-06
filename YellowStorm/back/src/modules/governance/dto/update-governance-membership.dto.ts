import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateGovernanceMembershipDto } from './create-governance-membership.dto';

export class UpdateGovernanceMembershipDto extends PartialType(OmitType(CreateGovernanceMembershipDto, ['userId', 'groupId'] as const)) {}
