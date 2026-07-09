import { PartialType } from '@nestjs/swagger';
import { CreateGovernanceProgramDto } from './create-governance-program.dto';

export class UpdateGovernanceProgramDto extends PartialType(CreateGovernanceProgramDto) {}
