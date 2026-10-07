import { Inject, Injectable } from '@nestjs/common';
import type {
  SystemRevisionManifest,
  SystemRevisionResolution,
  SystemRevisionSource,
} from '@modules/app-runtime/ports/system-revision-source.port';
import {
  CONVERSATION_V2_TEMPLATE_STORE,
  type ConversationV2TemplateStore,
} from './conversation-v2-template.store';

/** Exposes the template catalog to App Runtime through SYSTEM_REVISION_SOURCE. */
@Injectable()
export class ConversationV2TemplateRevisionSource implements SystemRevisionSource {
  constructor(
    @Inject(CONVERSATION_V2_TEMPLATE_STORE)
    private readonly templates: ConversationV2TemplateStore,
  ) {}

  async findByRevisionId(revisionId: string): Promise<SystemRevisionResolution | null> {
    const row = await this.templates.findByRevisionId(revisionId);
    if (!row) {
      return null;
    }
    return { status: row.status, manifestObjectKey: row.manifestObjectKey };
  }

  async findRevision(revisionId: string): Promise<SystemRevisionManifest | null> {
    const row = await this.templates.findRevisionByRevisionId(revisionId);
    if (!row) {
      return null;
    }
    return {
      revisionId: row.revisionId,
      manifestHash: row.manifestHash,
      manifestObjectKey: row.manifestObjectKey,
      files: row.files,
    };
  }
}