import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import pyodideRuntimeConfig from '@config/pyodide-runtime.config';
import { AuthModule } from '@modules/auth/auth.module';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { ConnectorModule } from '@modules/connector/connector.module';
import { DocumentModule } from '@modules/document/document.module';
import { UserModule } from '@modules/user/user.module';
import { WorkspaceModule } from '@modules/workspace/workspace.module';
import { PyodideFileResolver } from './pyodide-file.resolver';
import { PyodideRuntimeInternalController } from './pyodide-runtime-internal.controller';
import { PyodideRuntimeDispatcher } from './pyodide-runtime.dispatcher';
import { PyodideRuntimeGateway } from './pyodide-runtime.gateway';
import { PyodideRuntimeRegistry } from './pyodide-runtime.registry';

@Module({
  imports: [ConfigModule.forFeature(pyodideRuntimeConfig), AuthModule, AuthorizationModule, ConnectorModule, DocumentModule, UserModule, WorkspaceModule],
  controllers: [PyodideRuntimeInternalController],
  providers: [
    PyodideRuntimeRegistry,
    PyodideRuntimeDispatcher,
    PyodideRuntimeGateway,
    PyodideFileResolver,
  ],
  exports: [PyodideRuntimeDispatcher],
})
export class PyodideRuntimeModule {}
