import { PartialType } from '@nestjs/swagger';
import { CreateGovernanceDeploymentDto } from './create-governance-deployment.dto';

export class UpdateGovernanceDeploymentDto extends PartialType(CreateGovernanceDeploymentDto) {}
