import { PartialType } from '@nestjs/swagger';
import { CreateConnectorCredentialDto } from './create-connector-credential.dto';

export class UpdateConnectorCredentialDto extends PartialType(CreateConnectorCredentialDto) {}
