import { Injectable } from '@nestjs/common';
import { RuntimeMcpAuthService } from '@modules/app-runtime/services/runtime-mcp-auth.service';
import type { AppRuntimeBinding } from '@modules/app-runtime/schemas/app-runtime-binding.schema';

@Injectable()
export class AppDataMcpAuthService {
  constructor(private readonly runtimeAuth: RuntimeMcpAuthService) {}

  resolveBinding(authorization: string | undefined): Promise<AppRuntimeBinding> {
    return this.runtimeAuth.resolveBinding(authorization);
  }
}
