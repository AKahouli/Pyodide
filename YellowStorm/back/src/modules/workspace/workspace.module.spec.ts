import 'reflect-metadata';
import { Inject, Injectable, Module, Optional, type Provider } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { WorkspaceModule } from './workspace.module';
import { DOCUMENT_STORE } from './stores';
import { PgDocumentStore } from './stores/postgres/pg-document-store';

describe('WorkspaceModule document-store boundary', () => {
  it('exports its real store alias to optional conversation consumers', async () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, WorkspaceModule) as Provider[];
    const exported = Reflect.getMetadata(MODULE_METADATA.EXPORTS, WorkspaceModule) as unknown[];
    const alias = providers.find(provider => typeof provider === 'object' && 'provide' in provider && provider.provide === DOCUMENT_STORE);
    expect(alias).toEqual({ provide: DOCUMENT_STORE, useExisting: PgDocumentStore });
    expect(exported).toContain(DOCUMENT_STORE);

    // Keep the module's actual alias/export contract, replacing only database construction.
    const store = { withWorkspaceTreeLock: jest.fn() };
    @Module({ providers: [{ provide: PgDocumentStore, useValue: store }, alias!],
      exports: exported.filter(token => token === DOCUMENT_STORE) })
    class WorkspaceBoundary {}
    @Injectable()
    class ConversationConsumer {
      constructor(@Optional() @Inject(DOCUMENT_STORE) readonly documentStore?: unknown) {}
    }
    const module = await Test.createTestingModule({ imports: [WorkspaceBoundary], providers: [ConversationConsumer] }).compile();
    expect(module.get(ConversationConsumer).documentStore).toBe(store);
    await module.close();
  });
});
