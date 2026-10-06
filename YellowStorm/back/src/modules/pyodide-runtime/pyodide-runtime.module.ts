import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import pyodideRuntimeConfig from '@config/pyodide-runtime.config';
import { AuthModule } from '@modules/auth/auth.module';
import { PyodideRuntimeInternalController } from './pyodide-runtime-internal.controller';
import { PyodideRuntimeDispatcher } from './pyodide-runtime.dispatcher';
import { PyodideRuntimeGateway } from './pyodide-runtime.gateway';
import { PyodideRuntimeRegistry } from './pyodide-runtime.registry';

@Module({
  imports: [ConfigModule.forFeature(pyodideRuntimeConfig), AuthModule],
  controllers: [PyodideRuntimeInternalController],
  providers: [
    PyodideRuntimeRegistry,
    PyodideRuntimeDispatcher,
    PyodideRuntimeGateway,
  ],
  exports: [PyodideRuntimeDispatcher],
})
export class PyodideRuntimeModule {}
