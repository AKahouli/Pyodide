import { eq, inArray } from 'drizzle-orm';
import { Types } from 'mongoose';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { BackfillError } from '../../../scripts/migrate/harness';
import { compareRowChecksums } from '../../../scripts/migrate/reconcile';
import {
  ASSIGNMENT_COLUMNS,
  buildAssignment,
  buildFolder,
  buildRule,
  buildRun,
  FOLDER_COLUMNS,
  FolderPlan,
  insertAssignment,
  insertRow,
  RULE_COLUMNS,
  RUN_COLUMNS,
  validateAssignment,
  validateRule,
  validateRun,
  type ClassifierRefs,
  type Row,
} from '../../../scripts/migrate/2026-10-classifier.units';
import { describeIntegration, makeTestDb } from '../postgres/testing/pg-integration';

/**
 * The dev classifier data is small and has no cycles, misplaced parents or scope mismatches, so the
 * backfill would never exercise those paths. This drives the same mapping, validation and insert
 * with fabricated Mongo-shaped documents and checks every migrated row reads back identical.
 */
describeIntegration('classifier backfill mapping (integration)', () => {
  const { db, pool, close } = makeTestDb();
  const oid = (): string => newObjectId();
  const at = (iso: string): Date => new Date(iso);
  const objectId = (hex: string): Types.ObjectId => new Types.ObjectId(hex);

  const userId = oid();
  const workspaceId = oid();
  const otherWorkspaceId = oid();
  const documentId = oid();
  const goneWorkspaceId = oid(); // never inserted
  const goneDocumentId = oid();
  const goneUserId = oid();
  const playbookId = oid(); // a real flow: runs reference it with a foreign key (0041)

  const refs: ClassifierRefs = {
    workspaces: new Set([workspaceId, otherWorkspaceId]),
    documents: new Set([documentId]),
    users: new Set([userId]),
    playbooks: new Set([playbookId]),
  };

  beforeAll(async () => {
    await db.insert(schema.identityUsers).values({ id: userId, email: `cls-bf-${userId.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
    await db.insert(schema.playbookFlows).values({ id: playbookId, ownerId: userId, name: `cls bf flow ${playbookId}` });
    for (const id of [workspaceId, otherWorkspaceId]) {
      await db.insert(schema.workspaces).values({ id, name: `cls bf ${id}`, alias: `cls-bf-${id}`, storagePrefix: `cls-bf-${id}`, createdBy: userId, allocatedStorage: 1 });
    }
    await db.insert(schema.workspaceDocuments).values({ id: documentId, originalName: 'bf.pdf', mimeType: 'application/pdf', size: 1, workspaceId, createdBy: userId });
  });

  afterAll(async () => {
    await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, [workspaceId, otherWorkspaceId]));
    await db.delete(schema.identityUsers).where(eq(schema.identityUsers.id, userId));
    await close();
  });

  const folderDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    _id: new Types.ObjectId(), workspaceId: objectId(workspaceId), parentId: null, name: 'Contracts', description: 'Signed contracts',
    createdBy: objectId(userId), createdAt: at('2026-03-01T09:00:00Z'), updatedAt: at('2026-03-01T09:30:00Z'), ...over,
  });
  const readBack = async (table: string, columns: string[], id: unknown) => {
    const back = await pool.query(`SELECT ${columns.join(', ')} FROM ${table} WHERE id = $1`, [id]);
    expect(back.rows).toHaveLength(1);
    return back.rows[0] as Row;
  };
  const sameContent = (row: Row, back: Row) => { expect(compareRowChecksums(new Map([[String(row.id), row]]), new Map([[String(row.id), back]]))).toMatchObject({ match: true, compared: 1, mismatchTotal: 0 }); };

  describe('folders', () => {
    it('maps, inserts and reads back identical', async () => {
      const row = buildFolder(folderDoc());
      await new FolderPlan([folderDoc()], refs).insert(pool, row);
      sameContent(row, await readBack('classifier.folders', FOLDER_COLUMNS, row.id));
    });

    it('inserts a child that the cursor reaches before its parent by writing the ancestors first', async () => {
      const grandparent = folderDoc({ name: 'g' });
      const parent = folderDoc({ name: 'p', parentId: grandparent._id });
      const child = folderDoc({ name: 'c', parentId: parent._id });
      // Cursor order puts the deepest folder first.
      const plan = new FolderPlan([child, parent, grandparent], refs);
      const rows = [child, parent, grandparent].map(buildFolder);

      expect(rows.map((r) => plan.validate(r))).toEqual([null, null, null]);
      await plan.insert(pool, rows[0]);
      for (const row of rows) sameContent(row, await readBack('classifier.folders', FOLDER_COLUMNS, row.id));
      // The ancestors are then visited by the cursor: inserting them again is a no-op.
      await plan.insert(pool, rows[1]);
      await plan.insert(pool, rows[2]);
    });

    it('rejects folders that Postgres could not hold, and says why', async () => {
      const gone = folderDoc({ name: 'gone', workspaceId: objectId(goneWorkspaceId) });
      const underGone = folderDoc({ name: 'under-gone', workspaceId: objectId(goneWorkspaceId), parentId: gone._id });
      const orphanParent = folderDoc({ name: 'orphan', parentId: new Types.ObjectId() });
      const parentElsewhere = folderDoc({ name: 'elsewhere', workspaceId: objectId(otherWorkspaceId) });
      const crossWorkspace = folderDoc({ name: 'cross', parentId: parentElsewhere._id });
      const strangerAuthor = folderDoc({ name: 'stranger', createdBy: objectId(goneUserId) });
      const tooLong = folderDoc({ name: 'x'.repeat(101) });
      const cycleA = folderDoc({ name: 'a' });
      const cycleB = folderDoc({ name: 'b', parentId: cycleA._id });
      cycleA.parentId = cycleB._id;

      const all = [gone, underGone, orphanParent, parentElsewhere, crossWorkspace, strangerAuthor, tooLong, cycleA, cycleB];
      const plan = new FolderPlan(all, refs);
      const verdict = (doc: Record<string, unknown>) => plan.validate(buildFolder(doc));

      expect(verdict(gone)).toMatch(/dangling workspace_id/);
      expect(verdict(underGone)).toMatch(/dangling workspace_id/);
      expect(verdict(orphanParent)).toMatch(/cannot be migrated .*does not exist in Mongo/);
      expect(verdict(parentElsewhere)).toBeNull();
      expect(verdict(crossWorkspace)).toMatch(/belongs to another workspace/);
      expect(verdict(strangerAuthor)).toMatch(/dangling created_by/);
      expect(verdict(tooLong)).toMatch(/name length 101/);
      expect(verdict(cycleA)).toMatch(/cycle/);
      expect(verdict(cycleB)).toMatch(/cycle/);
    });

    it('reports a malformed id as a failure', () => {
      expect(() => buildFolder(folderDoc({ _id: 'not-an-id' }))).toThrow(BackfillError);
      expect(() => buildFolder(folderDoc({ workspaceId: undefined }))).toThrow(/workspaceId/);
    });
  });

  describe('assignments', () => {
    const assignmentDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      _id: new Types.ObjectId(), workspaceId: objectId(workspaceId), documentId: objectId(documentId), folderId: null, assignmentSource: 'manual',
      assignedBy: objectId(userId), createdAt: at('2026-03-02T09:00:00Z'), updatedAt: at('2026-03-02T09:30:00Z'), ...over,
    });

    it('maps, inserts and reads back identical, with its folder and run', async () => {
      const folder = buildFolder(folderDoc({ name: 'asg-folder' }));
      await insertRow(pool, 'classifier.folders', FOLDER_COLUMNS, folder);
      const run = buildRun({
        _id: new Types.ObjectId(), workspaceId: objectId(workspaceId), status: 'success', playbookId: objectId(playbookId), triggeredBy: objectId(userId),
        totalFiles: 3, classifiedFiles: 3, createdAt: at('2026-03-02T08:00:00Z'), updatedAt: at('2026-03-02T08:05:00Z'),
      });
      await insertRow(pool, 'classifier.runs', RUN_COLUMNS, run);

      const row = buildAssignment(assignmentDoc({ folderId: objectId(String(folder.id)), assignmentSource: 'playbook', classificationRunId: objectId(String(run.id)) }));
      expect(validateAssignment(row, refs)).toBeNull();
      await insertAssignment(pool, row, new Set([String(folder.id)]), new Set([String(run.id)]));
      sameContent(row, await readBack('classifier.file_assignments', ASSIGNMENT_COLUMNS, row.id));
    });

    it('keeps the file but drops a folder or run that no longer exists, resetting the source like the foreign key would', async () => {
      const secondDocument = oid();
      await db.insert(schema.workspaceDocuments).values({ id: secondDocument, originalName: 'bf2.pdf', mimeType: 'application/pdf', size: 1, workspaceId, createdBy: userId });
      refs.documents = new Set([...refs.documents, secondDocument]);
      const row = buildAssignment(assignmentDoc({
        documentId: objectId(secondDocument), folderId: new Types.ObjectId(), assignmentSource: 'playbook', classificationRunId: new Types.ObjectId(),
      }));

      await insertAssignment(pool, row, new Set(), new Set());

      expect(await readBack('classifier.file_assignments', ASSIGNMENT_COLUMNS, row.id)).toMatchObject({
        folder_id: null, assignment_source: 'manual', classification_run_id: null, document_id: secondDocument,
      });
    });

    it('rejects an assignment whose workspace, document or author is gone', () => {
      expect(validateAssignment(buildAssignment(assignmentDoc({ workspaceId: objectId(goneWorkspaceId) })), refs)).toMatch(/dangling workspace_id/);
      expect(validateAssignment(buildAssignment(assignmentDoc({ documentId: objectId(goneDocumentId) })), refs)).toMatch(/dangling document_id/);
      expect(validateAssignment(buildAssignment(assignmentDoc({ assignedBy: objectId(goneUserId) })), refs)).toMatch(/dangling assigned_by/);
    });
  });

  describe('rules', () => {
    const ruleDoc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
      _id: new Types.ObjectId(), userId: objectId(userId), scope: 'local', workspaceId: objectId(workspaceId), text: 'Invoices go to Finance',
      enabled: false, createdAt: at('2026-03-03T09:00:00Z'), updatedAt: at('2026-03-03T09:30:00Z'), ...over,
    });

    it('maps, inserts and reads back identical, and strips U+0000', async () => {
      const row = buildRule(ruleDoc({ text: 'bad\u0000text' }));
      expect(row.text).toBe('badtext');
      expect(validateRule(row, refs)).toBeNull();
      await insertRow(pool, 'classifier.rules', RULE_COLUMNS, row);
      sameContent(row, await readBack('classifier.rules', RULE_COLUMNS, row.id));

      const global = buildRule(ruleDoc({ scope: 'global', workspaceId: null, enabled: undefined }));
      expect(global).toMatchObject({ scope: 'global', workspace_id: null, enabled: true });
      expect(validateRule(global, refs)).toBeNull();
    });

    it('rejects a rule Postgres would refuse', () => {
      expect(validateRule(buildRule(ruleDoc({ scope: 'global' })), refs)).toMatch(/inconsistent/);
      expect(validateRule(buildRule(ruleDoc({ workspaceId: null })), refs)).toMatch(/inconsistent/);
      expect(validateRule(buildRule(ruleDoc({ scope: 'team' })), refs)).toMatch(/neither global nor local/);
      expect(validateRule(buildRule(ruleDoc({ text: '' })), refs)).toMatch(/text length 0/);
      expect(validateRule(buildRule(ruleDoc({ workspaceId: objectId(goneWorkspaceId) })), refs)).toMatch(/dangling workspace_id/);
      expect(validateRule(buildRule(ruleDoc({ userId: objectId(goneUserId) })), refs)).toMatch(/dangling user_id/);
    });
  });

  describe('runs', () => {
    it('maps every column, inserts and reads back identical', async () => {
      const row = buildRun({
        _id: new Types.ObjectId(), workspaceId: objectId(workspaceId), status: 'failed', playbookId: objectId(playbookId), playbookExecutionId: 'exec-9',
        hint: 'prefer\u0000 contracts', overwriteExisting: true, totalFiles: 12, classifiedFiles: 5, error: 'timeout',
        startedAt: at('2026-03-04T10:00:00Z'), finishedAt: at('2026-03-04T10:07:00Z'), triggeredBy: objectId(userId),
        createdAt: at('2026-03-04T09:59:00Z'), updatedAt: at('2026-03-04T10:07:00Z'),
      });
      expect(row.hint).toBe('prefer contracts');
      expect(validateRun(row, refs)).toBeNull();
      await insertRow(pool, 'classifier.runs', RUN_COLUMNS, row);
      sameContent(row, await readBack('classifier.runs', RUN_COLUMNS, row.id));
    });

    it('rejects a run whose workspace, author or playbook is gone, and clamps a corrupt counter', () => {
      const base = { _id: new Types.ObjectId(), workspaceId: objectId(workspaceId), playbookId: objectId(playbookId), triggeredBy: objectId(userId) };
      expect(validateRun(buildRun({ ...base, workspaceId: objectId(goneWorkspaceId) }), refs)).toMatch(/dangling workspace_id/);
      expect(validateRun(buildRun({ ...base, triggeredBy: objectId(goneUserId) }), refs)).toMatch(/dangling triggered_by/);
      expect(validateRun(buildRun({ ...base, playbookId: new Types.ObjectId() }), refs)).toMatch(/dangling playbook_id/);
      expect(buildRun({ ...base, totalFiles: -4, classifiedFiles: 'x' })).toMatchObject({ total_files: 0, classified_files: 0, status: 'queued' });
    });
  });

  it('is idempotent: a second insert of the same id is a no-op', async () => {
    const row = buildRule({ _id: new Types.ObjectId(), userId: objectId(userId), scope: 'global', workspaceId: null, text: 'once', createdAt: at('2026-03-05T00:00:00Z'), updatedAt: at('2026-03-05T00:00:00Z') });
    await insertRow(pool, 'classifier.rules', RULE_COLUMNS, row);
    await insertRow(pool, 'classifier.rules', RULE_COLUMNS, { ...row, text: 'changed' });
    expect((await pool.query('SELECT text FROM classifier.rules WHERE id = $1', [row.id])).rows).toEqual([{ text: 'once' }]);
  });
});
