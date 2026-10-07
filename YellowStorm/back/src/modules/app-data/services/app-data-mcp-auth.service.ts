import { Injectable } from '@nestjs/common';
import { RuntimeMcpAuthService } from '@modules/app-runtime/services/runtime-mcp-auth.service';
import type { RuntimeBindingRecord as AppRuntimeBinding } from '@modules/app-runtime/persistence/runtime-binding.store';

@Injectable()
export class AppDataMcpAuthService {
  constructor(private readonly runtimeAuth: RuntimeMcpAuthService) {}

  resolveBinding(authorization: string | undefined): Promise<AppRuntimeBinding> {
    return this.runtimeAuth.resolveBinding(authorization);
  }
}
