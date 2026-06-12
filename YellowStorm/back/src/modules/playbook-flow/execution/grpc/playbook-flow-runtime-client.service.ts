import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  buildGrpcChannelCredentials,
  createGrpcMetadata,
} from '../../../../common/grpc/grpc-security.util';

@Injectable()
/**
 * Owns playbook runtime gRPC transport setup and raw method dispatch so
 * execution orchestration does not load proto descriptors directly.
 */
export class PlaybookFlowRuntimeClientService {
  private readonly logger = new Logger(PlaybookFlowRuntimeClientService.name);
  private client: any;
  private available = false;

  constructor(private readonly configService: ConfigService) {}

  init(): void {
    try {
      const protoPath = this.resolveProtoPath();
      const packageDefinition = protoLoader.loadSync(protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });
      const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
      const pfPackage = protoDescriptor.playbook_flow as any;
      const grpcUrl = this.configService.get<string>('playbook-flow.grpcUrl', 'localhost:50051');
      const { credentials, options } = buildGrpcChannelCredentials(
        this.configService,
        (msg) => this.logger.warn(msg),
      );
      this.client = new pfPackage.PlaybookFlowRuntime(grpcUrl, credentials, options);
      this.available = true;
      this.logger.log(`Playbook flow gRPC client initialized at ${grpcUrl}`);
    } catch (err) {
      this.available = false;
      this.logger.error('Failed to initialize playbook flow gRPC client', err instanceof Error ? err.stack : undefined);
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  run(request: Record<string, unknown>): any {
    return this.client.Run(request, createGrpcMetadata(this.configService));
  }

  runFromCheckpoint(request: Record<string, unknown>): any {
    return this.client.RunFromCheckpoint(
      request,
      createGrpcMetadata(this.configService),
    );
  }

  cancel(request: Record<string, unknown>, callback: (err: Error | null) => void): void {
    this.client.Cancel(request, createGrpcMetadata(this.configService), callback);
  }

  resumeApproval(request: Record<string, unknown>, callback: (err: Error | null) => void): void {
    this.client.ResumeApproval(
      request,
      createGrpcMetadata(this.configService),
      callback,
    );
  }

  resumeFromStep(request: Record<string, unknown>, callback: (err: Error | null) => void): void {
    this.client.ResumeFromStep(
      request,
      createGrpcMetadata(this.configService),
      callback,
    );
  }

  private resolveProtoPath(): string {
    const candidates = [
      path.join(__dirname, '..', '..', 'proto', 'playbook-flow.proto'),
      path.join(__dirname, '..', '..', '..', 'playbook-flow', 'proto', 'playbook-flow.proto'),
      path.join(process.cwd(), 'dist', 'modules', 'playbook-flow', 'proto', 'playbook-flow.proto'),
      path.join(process.cwd(), 'src', 'modules', 'playbook-flow', 'proto', 'playbook-flow.proto'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return candidates[2];
  }
}
