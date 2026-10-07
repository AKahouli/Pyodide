import { eq, inArray } from 'drizzle-orm';
import { isUniqueViolation, newObjectId, withTransaction } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { AssignmentSource, ClassificationRunStatus, ClassifierRuleScope } from '../classifier.types';
import { ClassificationRunRepository } from './classification-run.repository';
import { ClassifierAssignmentRepository } from './classifier-assignment.repository';
import { ClassifierFolderRepository } from './classifier-folder.repository';
import { ClassifierRuleRepository } from './classifier-rule.repository';

describeIntegration('classifier repositories (integration)', () => {
  const oid = (): string => newObjectId();
  const { db, close } = makeTestDb();
  const folders = new ClassifierFolderRepository(db as never);
  const assignments = new ClassifierAssignmentRepository(db as never);
  const rules = new ClassifierRuleRepository(db as never);
  const runs = new ClassificationRunRepository(db as never);

  let userId: string;
  let otherUserId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  const documentIds = [oid(), oid(), oid(), oid()];
  const playbookId = oid();

  const newDocument = async (workspace = workspaceId): Promise<string> => {
    const id = oid();
    await db.insert(schema.workspaceDocuments).values({ id, originalName: `${id}.pdf`, mimeType: 'application/pdf', size: 1, workspaceId: workspace, createdBy: userId });
    return id;
  };

  const folder = (name: string, parentId: string | null = null, workspace = workspaceId) =>
    folders.create({ workspaceId: workspace, parentId, name, description: `${name} folder`, createdBy: userId });

  beforeAll(async () => {
    userId = oid();
    otherUserId = oid();
    workspaceId = oid();
    otherWorkspaceId = oid();
    for (const id of [userId, otherUserId]) {
      await db.insert(schema.identityUsers).values({ id, email: `cls-${id.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
    }
    // Runs reference their playbook with a foreign key (0041); the user owns it, so it goes with the user.
    await db.insert(schema.playbookFlows).values({ id: playbookId, ownerId: userId, name: `cls flow ${playbookId}` });
    for (const id of [workspaceId, otherWorkspaceId]) {
      await db.insert(schema.workspaces).values({ id, name: `cls ws ${id}`, alias: `cls-${id}`, storagePrefix: `cls-${id}`, createdBy: userId, allocatedStorage: 1 });
    }
    for (const id of documentIds) {
      await db.insert(schema.workspaceDocuments).values({ id, originalName: `${id}.pdf`, mimeType: 'application/pdf', size: 1, workspaceId, createdBy: userId });
    }
  });

  afterAll(async () => {
    // The workspaces own every classifier row through cascading foreign keys; users go last.
    await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, [workspaceId, otherWorkspaceId]));
    await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, [userId, otherUserId]));
    await close();
  });

  describe('folders', () => {
    it('lists a workspace by code point, so upper case sorts before lower case', async () => {
      const ws = oid();
      await db.insert(schema.workspaces).values({ id: ws, name: `cls sort ${ws}`, alias: `cls-${ws}`, storagePrefix: `cls-${ws}`, createdBy: userId, allocatedStorage: 1 });
      try {
        for (const name of ['b', 'a', 'B', 'A']) await folder(name, null, ws);
        expect((await folders.listByWorkspace(ws)).map((f) => f.name)).toEqual(['A', 'B', 'a', 'b']);
        expect(await folders.listByWorkspace(oid())).toEqual([]);
        expect(await folders.listByWorkspace('not-an-id')).toEqual([]);
      } finally {
        await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws));
      }
    });

    it('enforces the name at one location, roots included', async () => {
      const parent = await folder('uniq-parent');
      await folder('twin', parent.id);
      const clash = await folder('twin', parent.id).catch((e: unknown) => e);
      expect(isUniqueViolation(clash, 'uq_classifier_folders_location')).toBe(true);

      await folder('root-twin');
      const rootClash = await folder('root-twin').catch((e: unknown) => e);
      expect(isUniqueViolation(rootClash, 'uq_classifier_folders_location')).toBe(true);

      // The same name under another parent, or in another workspace, is fine.
      const sibling = await folder('uniq-parent-2');
      await expect(folder('twin', sibling.id)).resolves.toMatchObject({ name: 'twin' });
      await expect(folder('root-twin', null, otherWorkspaceId)).resolves.toMatchObject({ name: 'root-twin' });
    });

    it('answers nameTaken for a location and lets a folder keep its own name', async () => {
      const parent = await folder('taken-parent');
      const child = await folder('taken', parent.id);
      expect(await folders.nameTaken(workspaceId, parent.id, 'taken')).toBe(true);
      expect(await folders.nameTaken(workspaceId, parent.id, 'taken', child.id)).toBe(false);
      expect(await folders.nameTaken(workspaceId, null, 'taken')).toBe(false);
      expect(await folders.nameTaken(workspaceId, parent.id, 'other')).toBe(false);
    });

    it('updates and moves a folder, bumping updatedAt', async () => {
      const a = await folder('move-a');
      const b = await folder('move-b');
      const renamed = await folders.update(a.id, { name: 'move-a2', description: 'changed' });
      expect(renamed).toMatchObject({ name: 'move-a2', description: 'changed' });
      expect(renamed!.updatedAt.getTime()).toBeGreaterThanOrEqual(a.updatedAt.getTime());
      const moved = await folders.setParent(a.id, b.id);
      expect(moved?.parentId).toBe(b.id);
      expect((await folders.setParent(a.id, null))?.parentId).toBeNull();
      expect(await folders.update(oid(), { name: 'x' })).toBeNull();
    });

    it('collects the descendants at every depth, and terminates on a corrupt cycle', async () => {
      const root = await folder('tree-root');
      const mid = await folder('tree-mid', root.id);
      const leaf = await folder('tree-leaf', mid.id);
      const other = await folder('tree-other');
      expect((await folders.descendantIds(root.id)).sort()).toEqual([mid.id, leaf.id].sort());
      expect(await folders.descendantIds(leaf.id)).toEqual([]);
      expect(await folders.descendantIds(other.id)).toEqual([]);

      await folders.setParent(root.id, leaf.id); // root → mid → leaf → root
      expect((await folders.descendantIds(root.id)).sort()).toEqual([root.id, mid.id, leaf.id].sort());
    });

    it('deletes a sub-tree, unassigns its files atomically and leaves the rest alone', async () => {
      const root = await folder('del-root');
      const mid = await folder('del-mid', root.id);
      const leaf = await folder('del-leaf', mid.id);
      const keep = await folder('del-keep');
      const [d0, d1, d2, d3] = documentIds;
      await assignments.upsertManual({ workspaceId, documentId: d0, folderId: root.id, assignedBy: userId });
      await assignments.upsertManual({ workspaceId, documentId: d1, folderId: leaf.id, assignedBy: userId });
      await assignments.upsertManual({ workspaceId, documentId: d2, folderId: keep.id, assignedBy: userId });
      await assignments.applyPlaybookResult({ workspaceId, documentId: d3, folderId: leaf.id, runId: (await runs.create({ workspaceId, playbookId, hint: null, overwriteExisting: false, totalFiles: 1, triggeredBy: userId })).id, assignedBy: userId, overwrite: true });

      expect(await folders.deleteWithDescendants(root.id)).toBe(2);

      expect(await folders.findById(root.id)).toBeNull();
      expect(await folders.findById(mid.id)).toBeNull();
      expect(await folders.findById(leaf.id)).toBeNull();
      expect(await folders.findById(keep.id)).not.toBeNull();
      const byDoc = new Map((await assignments.listByWorkspace(workspaceId)).map((a) => [a.documentId, a]));
      for (const doc of [d0, d1, d3]) {
        expect(byDoc.get(doc)).toMatchObject({ folderId: null, assignmentSource: AssignmentSource.MANUAL });
      }
      expect(byDoc.get(d2)?.folderId).toBe(keep.id);
    });

    it('counts child folders and assigned files per folder', async () => {
      const parent = await folder('count-parent');
      const childA = await folder('count-a', parent.id);
      await folder('count-b', parent.id);
      const docs = documentIds.slice(0, 2);
      for (const documentId of docs) await assignments.upsertManual({ workspaceId, documentId, folderId: parent.id, assignedBy: userId });

      const counts = await folders.computeCounts(workspaceId, [parent.id, childA.id]);
      expect(counts.get(parent.id)).toEqual({ childCount: 2, fileCount: 2 });
      expect(counts.get(childA.id)).toEqual({ childCount: 0, fileCount: 0 });
      expect((await folders.computeCounts(workspaceId, [])).size).toBe(0);
    });

    it('is removed with its workspace', async () => {
      const ws = oid();
      await db.insert(schema.workspaces).values({ id: ws, name: `cls cascade ${ws}`, alias: `cls-${ws}`, storagePrefix: `cls-${ws}`, createdBy: userId, allocatedStorage: 1 });
      const f = await folder('cascade-me', null, ws);
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws));
      expect(await folders.findById(f.id)).toBeNull();
    });
  });

  describe('assignments', () => {
    const [doc] = documentIds;

    it('creates then overwrites one row per document, forgetting an earlier run', async () => {
      const f1 = await folder('asg-1');
      const f2 = await folder('asg-2');
      const run = await runs.create({ workspaceId, playbookId, hint: null, overwriteExisting: false, totalFiles: 1, triggeredBy: userId });
      await assignments.applyPlaybookResult({ workspaceId, documentId: doc, folderId: f1.id, runId: run.id, assignedBy: userId, overwrite: true });

      const manual = await assignments.upsertManual({ workspaceId, documentId: doc, folderId: f2.id, assignedBy: otherUserId });
      expect(manual).toMatchObject({ folderId: f2.id, assignmentSource: AssignmentSource.MANUAL, classificationRunId: null, assignedBy: otherUserId });
      expect((await assignments.listByWorkspace(workspaceId)).filter((a) => a.documentId === doc)).toHaveLength(1);

      const cleared = await assignments.upsertManual({ workspaceId, documentId: doc, folderId: null, assignedBy: userId });
      expect(cleared.folderId).toBeNull();
    });

    it('applies a playbook result to an unassigned file, and to an assigned one only with overwrite', async () => {
      const docB = await newDocument();
      const target = await folder('pb-target');
      const other = await folder('pb-other');
      const run = await runs.create({ workspaceId, playbookId, hint: null, overwriteExisting: false, totalFiles: 1, triggeredBy: userId });
      const input = { workspaceId, documentId: docB, folderId: target.id, runId: run.id, assignedBy: userId };
      const stateOf = async () => (await assignments.listByWorkspace(workspaceId)).find((a) => a.documentId === docB);

      // No row yet: classified even without overwrite.
      expect(await assignments.applyPlaybookResult({ ...input, overwrite: false })).toBe(true);
      expect(await stateOf()).toMatchObject({ folderId: target.id, assignmentSource: AssignmentSource.PLAYBOOK, classificationRunId: run.id });

      // Already in a folder: left alone without overwrite, replaced with it.
      expect(await assignments.applyPlaybookResult({ ...input, folderId: other.id, overwrite: false })).toBe(false);
      expect((await stateOf())?.folderId).toBe(target.id);
      expect(await assignments.applyPlaybookResult({ ...input, folderId: other.id, overwrite: true })).toBe(true);
      expect((await stateOf())?.folderId).toBe(other.id);

      // Back to unassigned by hand: a non-overwrite run may classify it again.
      await assignments.upsertManual({ workspaceId, documentId: docB, folderId: null, assignedBy: userId });
      expect(await assignments.applyPlaybookResult({ ...input, overwrite: false })).toBe(true);
    });

    it('skips a result that points at a missing folder without poisoning an outer transaction', async () => {
      const docC = await newDocument();
      const good = await folder('pb-good');
      const run = await runs.create({ workspaceId, playbookId, hint: null, overwriteExisting: false, totalFiles: 2, triggeredBy: userId });
      const base = { workspaceId, runId: run.id, assignedBy: userId, overwrite: true };

      await withTransaction(db, async () => {
        expect(await assignments.applyPlaybookResult({ ...base, documentId: docC, folderId: oid() })).toBe(false);
        expect(await assignments.applyPlaybookResult({ ...base, documentId: docC, folderId: good.id })).toBe(true);
      });
      expect((await assignments.listByWorkspace(workspaceId)).find((a) => a.documentId === docC)?.folderId).toBe(good.id);
    });

    it('counts only the files that sit in a folder', async () => {
      const ws = oid();
      const docId = oid();
      await db.insert(schema.workspaces).values({ id: ws, name: `cls count ${ws}`, alias: `cls-${ws}`, storagePrefix: `cls-${ws}`, createdBy: userId, allocatedStorage: 1 });
      await db.insert(schema.workspaceDocuments).values({ id: docId, originalName: 'c.pdf', mimeType: 'application/pdf', size: 1, workspaceId: ws, createdBy: userId });
      try {
        expect(await assignments.countClassified(ws)).toBe(0);
        await assignments.upsertManual({ workspaceId: ws, documentId: docId, folderId: null, assignedBy: userId });
        expect(await assignments.countClassified(ws)).toBe(0);
        const f = await folder('counted', null, ws);
        await assignments.upsertManual({ workspaceId: ws, documentId: docId, folderId: f.id, assignedBy: userId });
        expect(await assignments.countClassified(ws)).toBe(1);
      } finally {
        await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws));
      }
    });

    it('goes away with its document, and falls back to no run when the run is deleted', async () => {
      const docId = oid();
      await db.insert(schema.workspaceDocuments).values({ id: docId, originalName: 'gone.pdf', mimeType: 'application/pdf', size: 1, workspaceId, createdBy: userId });
      const f = await folder('gone-folder');
      const run = await runs.create({ workspaceId, playbookId, hint: null, overwriteExisting: false, totalFiles: 1, triggeredBy: userId });
      await assignments.applyPlaybookResult({ workspaceId, documentId: docId, folderId: f.id, runId: run.id, assignedBy: userId, overwrite: true });

      await db.delete(schema.classifierRuns).where(eq(schema.classifierRuns.id, run.id));
      expect((await assignments.listByWorkspace(workspaceId)).find((a) => a.documentId === docId)?.classificationRunId).toBeNull();

      await db.delete(schema.workspaceDocuments).where(eq(schema.workspaceDocuments.id, docId));
      expect((await assignments.listByWorkspace(workspaceId)).find((a) => a.documentId === docId)).toBeUndefined();
    });
  });

  describe('rules', () => {
    it('lists the user\'s rules newest first, filtered by scope and workspace', async () => {
      const global = await rules.create({ userId, scope: ClassifierRuleScope.GLOBAL, workspaceId: null, text: 'global rule', enabled: true });
      const local = await rules.create({ userId, scope: ClassifierRuleScope.LOCAL, workspaceId, text: 'local rule', enabled: true });
      const elsewhere = await rules.create({ userId, scope: ClassifierRuleScope.LOCAL, workspaceId: otherWorkspaceId, text: 'other ws rule', enabled: true });
      await rules.create({ userId: otherUserId, scope: ClassifierRuleScope.GLOBAL, workspaceId: null, text: 'not mine', enabled: true });

      const all = (await rules.listForUser(userId, {})).map((r) => r.id);
      expect(all.indexOf(elsewhere.id)).toBeLessThan(all.indexOf(local.id));
      expect(all.indexOf(local.id)).toBeLessThan(all.indexOf(global.id));

      expect((await rules.listForUser(userId, { scope: ClassifierRuleScope.GLOBAL, workspaceId: null })).map((r) => r.id)).toEqual([global.id]);
      expect((await rules.listForUser(userId, { scope: ClassifierRuleScope.LOCAL, workspaceId })).map((r) => r.id)).toEqual([local.id]);
      expect((await rules.listForUser(userId, { workspaceId: otherWorkspaceId })).map((r) => r.id)).toEqual([elsewhere.id]);
      expect(await rules.listForUser(userId, { workspaceId: 'not-an-id' })).toEqual([]);
    });

    it('returns the enabled global and local rules of a workspace, oldest first', async () => {
      const ws = oid();
      await db.insert(schema.workspaces).values({ id: ws, name: `cls rules ${ws}`, alias: `cls-${ws}`, storagePrefix: `cls-${ws}`, createdBy: userId, allocatedStorage: 1 });
      const scopedUser = oid();
      await db.insert(schema.identityUsers).values({ id: scopedUser, email: `cls-${scopedUser.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
      try {
        const g = await rules.create({ userId: scopedUser, scope: ClassifierRuleScope.GLOBAL, workspaceId: null, text: 'g', enabled: true });
        await rules.create({ userId: scopedUser, scope: ClassifierRuleScope.GLOBAL, workspaceId: null, text: 'g-off', enabled: false });
        const l = await rules.create({ userId: scopedUser, scope: ClassifierRuleScope.LOCAL, workspaceId: ws, text: 'l', enabled: true });
        await rules.create({ userId: scopedUser, scope: ClassifierRuleScope.LOCAL, workspaceId: otherWorkspaceId, text: 'l-other', enabled: true });

        expect((await rules.listActiveForWorkspace(scopedUser, ws)).map((r) => r.id)).toEqual([g.id, l.id]);
        expect(await rules.listActiveForWorkspace(scopedUser, 'nope')).toEqual([]);
      } finally {
        await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws));
        await db.delete(schema.identityUsers).where(eq(schema.identityUsers.id, scopedUser)); // takes its rules with it
      }
      expect(await rules.listForUser(scopedUser, {})).toEqual([]);
    });

    it('updates, finds and deletes a rule, and rejects a global rule with a workspace', async () => {
      const rule = await rules.create({ userId, scope: ClassifierRuleScope.GLOBAL, workspaceId: null, text: 'first', enabled: true });
      expect(await rules.update(rule.id, { text: 'second', enabled: false })).toMatchObject({ text: 'second', enabled: false });
      expect(await rules.findById(rule.id)).toMatchObject({ text: 'second' });
      await rules.delete(rule.id);
      expect(await rules.findById(rule.id)).toBeNull();
      expect(await rules.update(oid(), { text: 'x' })).toBeNull();

      await expect(rules.create({ userId, scope: ClassifierRuleScope.GLOBAL, workspaceId, text: 'bad', enabled: true })).rejects.toThrow();
      await expect(rules.create({ userId, scope: ClassifierRuleScope.LOCAL, workspaceId: null, text: 'bad', enabled: true })).rejects.toThrow();
    });
  });

  describe('runs', () => {
    it('creates a queued run, updates its lifecycle and pages a workspace newest first', async () => {
      const ws = oid();
      await db.insert(schema.workspaces).values({ id: ws, name: `cls runs ${ws}`, alias: `cls-${ws}`, storagePrefix: `cls-${ws}`, createdBy: userId, allocatedStorage: 1 });
      try {
        const created = [];
        for (let i = 0; i < 3; i++) {
          created.push(await runs.create({ workspaceId: ws, playbookId, hint: i === 0 ? 'a hint' : null, overwriteExisting: i === 1, totalFiles: i, triggeredBy: userId }));
        }
        expect(created[0]).toMatchObject({ status: ClassificationRunStatus.QUEUED, hint: 'a hint', overwriteExisting: false, classifiedFiles: 0, playbookExecutionId: null, startedAt: null });

        const startedAt = new Date('2026-09-20T10:00:00Z');
        await runs.updateStatus(created[0].id, { status: ClassificationRunStatus.RUNNING, playbookExecutionId: 'exec-1', startedAt });
        await runs.updateStatus(created[0].id, { status: ClassificationRunStatus.SUCCESS, classifiedFiles: 7, finishedAt: new Date('2026-09-20T10:05:00Z') });
        expect(await runs.findById(created[0].id)).toMatchObject({ status: 'success', playbookExecutionId: 'exec-1', classifiedFiles: 7, startedAt });
        expect(await runs.findById('nope')).toBeNull();

        const first = await runs.listByWorkspace(ws, 1, 2);
        expect(first.total).toBe(3);
        expect(first.items.map((r) => r.id)).toEqual([created[2].id, created[1].id]);
        const second = await runs.listByWorkspace(ws, 2, 2);
        expect(second.items.map((r) => r.id)).toEqual([created[0].id]);
        expect(second.total).toBe(3);
        const past = await runs.listByWorkspace(ws, 5, 2);
        expect(past.items).toEqual([]);
        expect(past.total).toBe(3);
      } finally {
        await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws));
      }
    });
  });
});
