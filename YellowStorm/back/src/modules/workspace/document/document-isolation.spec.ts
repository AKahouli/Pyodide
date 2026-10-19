import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { WorkspaceAccessGuard } from '../guards/workspace-access.guard';
import { WritePermissionGuard } from '../guards/write-permission.guard';
import { WorkspaceDocumentController } from '../workspace-document.controller';
import { WorkspaceDocumentRead } from './document-read';
import { ForbiddenException, NotFoundException } from '../../exceptions';

describe('Workspace document user isolation', () => {
  const alice = 'a'.repeat(24);
  const bob = 'b'.repeat(24);
  const aliceWorkspace = '1'.repeat(24);
  const bobWorkspace = '2'.repeat(24);
  const aliceDocument = '3'.repeat(24);
  const bobDocument = '4'.repeat(24);
  const records = [
    { id: aliceDocument, workspaceId: aliceWorkspace, path: 'alice/private.png', originalName: 'photo.png', status: 'completed' },
    { id: bobDocument, workspaceId: bobWorkspace, path: 'bob/private.png', originalName: 'photo.png', status: 'completed' },
  ];

  function setup() {
    const workspaces = { findById: jest.fn(async (id: string) => ({
      id, createdBy: id === aliceWorkspace ? alice : bob, isPublic: false,
    })) };
    const shares = { findOneByWorkspaceAndUser: jest.fn(async () => null) };
    const guard = new WorkspaceAccessGuard(workspaces as never, shares as never);
    const documents = { findByIdAndWorkspace: jest.fn(async (id: string, workspaceId: string) =>
      records.find((record) => record.id === id && record.workspaceId === workspaceId) ?? null) };
    const storage = { generateSasUrl: jest.fn(async (path: string) => `signed:${path}`) };
    const read = new WorkspaceDocumentRead(documents as never, storage as never,
      { get: (_key: string, fallback: number) => fallback } as ConfigService,
      { mapToResponse: (record: unknown) => record } as never, { setContext: jest.fn() } as never);
    const context = (userId: string, workspaceId: string) => {
      const request = { user: { _id: userId }, params: { workspaceId } };
      return { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
    };
    const download = async (userId: string, workspaceId: string, documentId: string) => {
      await guard.canActivate(context(userId, workspaceId));
      return read.getDownloadUrl(workspaceId, documentId);
    };
    return { context, guard, read, storage, documents, download };
  }

  it('keeps access and signed download paths isolated during concurrent requests', async () => {
    const t = setup();
    const outcomes = await Promise.allSettled([
      t.download(alice, aliceWorkspace, aliceDocument),
      t.download(bob, bobWorkspace, bobDocument),
      t.download(alice, bobWorkspace, bobDocument),
      t.download(bob, aliceWorkspace, aliceDocument),
    ]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'rejected']);
    for (const outcome of outcomes.slice(2)) {
      expect(outcome.status === 'rejected' && outcome.reason).toBeInstanceOf(ForbiddenException);
    }
    expect(t.storage.generateSasUrl.mock.calls.map(([path]) => path).sort()).toEqual(['alice/private.png', 'bob/private.png']);
    expect(t.documents.findByIdAndWorkspace).toHaveBeenCalledTimes(2);
  });

  it('does not issue a signed URL when an owner substitutes a document ID from another workspace', async () => {
    const t = setup();
    await expect(t.download(alice, aliceWorkspace, bobDocument)).rejects.toBeInstanceOf(NotFoundException);
    await expect(t.read.findById(bobWorkspace, aliceDocument)).rejects.toBeInstanceOf(NotFoundException);
    expect(t.storage.generateSasUrl).not.toHaveBeenCalled();
  });

  it('reauthorizes each request and denies access immediately after a share is revoked', async () => {
    const t = setup();
    const shareStore = { findOneByWorkspaceAndUser: jest.fn().mockResolvedValueOnce({ permission: 'read' }).mockResolvedValue(null) };
    const guard = new WorkspaceAccessGuard({ findById: async () => ({ id: aliceWorkspace, createdBy: alice, isPublic: false }) } as never,
      shareStore as never);
    const ctx = t.context(bob, aliceWorkspace);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(() => new WritePermissionGuard().canActivate(ctx)).toThrow(ForbiddenException);
    await expect(guard.canActivate(t.context(bob, aliceWorkspace))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('protects document routes and every upload entry point with the workspace and write guards', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, WorkspaceDocumentController)).toContain(WorkspaceAccessGuard);
    for (const name of ['uploadSmallFile', 'requestUploadUrl', 'confirmUpload', 'initiateBulkUpload', 'reportProgress', 'completeBulkUpload'] as const) {
      expect(Reflect.getMetadata(GUARDS_METADATA, WorkspaceDocumentController.prototype[name])).toContain(WritePermissionGuard);
    }
  });
});
