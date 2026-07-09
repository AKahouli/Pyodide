import { PartialType } from '@nestjs/swagger';
import { CreateGovernanceScopeDto } from './create-governance-scope.dto';

export class UpdateGovernanceScopeDto extends PartialType(CreateGovernanceScopeDto) {}
