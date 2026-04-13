import { PartialType } from '@nestjs/swagger';
import { CreateConnectedAppDefinitionDto } from './create-connected-app-definition.dto';

export class UpdateConnectedAppDefinitionDto extends PartialType(CreateConnectedAppDefinitionDto) {}
