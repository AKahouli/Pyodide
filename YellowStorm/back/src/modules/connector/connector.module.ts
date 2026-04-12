import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConnectorService } from './connector.service';
import { ConnectorCredentialService } from './connector-credential.service';
import { Connector, ConnectorSchema } from './schemas/connector.schema';
import { ConnectorCredential, ConnectorCredentialSchema } from './schemas/connector-credential.schema';
import { AdminConnectorController } from './admin-connector.controller';
import { ConnectorController } from './connector.controller';
import { AuthorizationModule } from '../authorization/authorization.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Connector.name, schema: ConnectorSchema },
      { name: ConnectorCredential.name, schema: ConnectorCredentialSchema },
    ]),
    AuthorizationModule,
  ],
  controllers: [AdminConnectorController, ConnectorController],
  providers: [ConnectorService, ConnectorCredentialService],
  exports: [ConnectorService, ConnectorCredentialService],
})
export class ConnectorModule {}
