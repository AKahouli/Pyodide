import { createHash, createPrivateKey, createPublicKey, randomUUID, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Inject, Injectable, forwardRef, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkspaceShareService } from '@modules/workspace/workspace-share.service';
import { WorkspaceDocumentRead } from '@modules/workspace/document/document-read';
import { UserService } from '@modules/user/services/user.service';
import { assertAccountApproved } from '@modules/user/utils/assert-account-accessible';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticModelService } from './semantic-model.service';
import { SemanticSourceAccessService } from './semantic-source-access.service';

export type AssetOperation = 'metadata' | 'read' | 'derived-put' | 'dataset-put' | 'dataset-get';
type Source = { workspaceId: string; assetId: string; version: string };
type Admission = { actor: string; model: string | null; purpose: 'discovery' | 'population'; sources: Source[];
  nonce: string; key: string; command: string; iat: number; exp: number };
export interface AssetExecutionProof { jobId: string; taskId: number; leaseEpoch: number; leaseOwner: string; capability: string }
export interface AssetTarget { datasetId?: string; fileName?: string; options?: Record<string, unknown> }
type Grant = AssetExecutionProof & Source & { operation: AssetOperation; admissionDigest: string; exp: number;
  target?: AssetTarget; namespace?: string };
interface LiveTask { command: Record<string, unknown>; actor: string; model: string | null; jobType: string; createdAt: Date | string }

/** Durable admission is NOT a bearer asset credential. Every use needs a live,
 * DB-fenced claim capability; grants themselves last five minutes at most. */
@Injectable()
export class SemanticAssetGrantService {
  constructor(private readonly config: ConfigService,
    private readonly database: SemanticModelDatabaseService,
    private readonly shares: WorkspaceShareService,
    private readonly documents: WorkspaceDocumentRead,
    private readonly users: UserService,
    @Inject(forwardRef(() => SemanticModelService)) private readonly models: SemanticModelService,
    private readonly access: SemanticSourceAccessService) {}

  private key() {
    // Reuse deployment signer infrastructure, never an MCP assertion or a service secret.
    const path = this.config.get<string>('MCP_JWT_PRIVATE_KEY_FILE');
    if (!path) throw new ServiceUnavailableException('Semantic asset signer is not configured');
    const key = createPrivateKey(readFileSync(path));
    if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048)
      throw new ServiceUnavailableException('Invalid semantic asset signer');
    return key;
  }

  private seal(typ: string, body: unknown): string {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ aud: 'yellowstorm-semantic-assets', body })).toString('base64url');
    const input = `${header}.${payload}`;
    return `${input}.${sign('RSA-SHA256', Buffer.from(input), this.key()).toString('base64url')}`;
  }

  private open<T>(token: string, typ: string): T {
    try {
      if (typeof token !== 'string' || token.length > 512000) throw new Error();
      const [header, payload, signature, extra] = token.split('.');
      if (!header || !payload || !signature || extra !== undefined) throw new Error();
      const h = JSON.parse(Buffer.from(header, 'base64url').toString()) as { alg: string; typ: string };
      const p = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { aud: string; body: T };
      if (h.alg !== 'RS256' || h.typ !== typ || p.aud !== 'yellowstorm-semantic-assets'
        || !verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), createPublicKey(this.key()), Buffer.from(signature, 'base64url'))) throw new Error();
      return p.body;
    } catch { throw new UnauthorizedException('Invalid semantic asset authority'); }
  }

  private version(document: { contentHash?: string | null; uploadedAt?: Date | string | null; size?: number }): string {
    const hash = document.contentHash?.trim().toLowerCase();
    const uploaded = document.uploadedAt instanceof Date ? document.uploadedAt.toISOString() : document.uploadedAt;
    if (!hash && (!uploaded || !Number.isSafeInteger(document.size))) throw new UnauthorizedException('Asset version unavailable');
    return hash || `uploaded:${uploaded}:${document.size}`;
  }

  async admit(actor: string, model: string | null, purpose: Admission['purpose'], refs: Array<{ workspaceId: string; assetId: string }>, admissionKey: string,
    command: Record<string, unknown>): Promise<string> {
    if (!actor || (purpose === 'population' && !model)) throw new UnauthorizedException('Invalid asset admission');
    const sources: Source[] = [];
    for (const ref of refs) {
      if (!ref.workspaceId || !ref.assetId || !/^[a-f0-9]{24}$/i.test(ref.assetId)) continue; // manual/derived records do not fetch workspace bytes
      await this.currentAccess(actor, model, ref.workspaceId);
      const doc = await this.documents.findById(ref.workspaceId, ref.assetId);
      sources.push({ ...ref, version: this.version(doc) });
    }
    const iat = Math.floor(Date.now() / 1000);
    return this.seal('semantic-asset-admission', { actor, model, purpose, sources, nonce: randomUUID(), key: admissionKey,
      command: JSON.stringify(command), iat, exp: iat + 300 } satisfies Admission);
  }

  /** Separate canonical command/admission for each currently mapped sheet. */
  async admitSourceEvent(eventId: string, occurredAt: string, payload: Record<string, unknown>): Promise<Record<string, string>> {
    const sheets = await this.database.query<{ sheet: string | null }>(
      'SELECT DISTINCT sheet_name AS sheet FROM semantic_model.source_mappings WHERE workspace_id=$1 AND document_id=$2',
      [payload.workspaceId, payload.documentId]);
    const source = { workspaceId: payload.workspaceId, assetId: payload.documentId,
      originalName: payload.originalName ?? null, mimeType: payload.mimeType, sizeBytes: payload.sizeBytes ?? null,
      contentHash: payload.contentHash ?? null, uploadedAt: payload.uploadedAt || occurredAt,
      indexingStatus: payload.indexingStatus ?? null, sourceEventId: eventId,
      sourceVersion: payload.contentHash || (payload.updatedAt && Number.isInteger(payload.sizeBytes)
        ? `${payload.updatedAt}:${payload.sizeBytes}` : null) };
    const admissions: Record<string, string> = {};
    for (const { sheet } of sheets.rows) {
      const command = { actorUserId: payload.createdBy, modelId: null, workspaceId: payload.workspaceId,
        payload: { source, options: sheet ? { sheetName: sheet } : {} } };
      admissions[sheet || ''] = await this.admit(payload.createdBy as string, null, 'discovery',
        [{ workspaceId: payload.workspaceId as string, assetId: payload.documentId as string }], `${eventId}:${sheet || ''}`, command);
    }
    return admissions;
  }

  private async currentAccess(actor: string, model: string | null, workspace: string): Promise<void> {
    const user = await this.users.findById(actor);
    if (!user) throw new UnauthorizedException('Invalid asset actor');
    assertAccountApproved(user);
    await this.shares.assertUserHasAccess(actor, [workspace]);
    if (model) {
      await this.models.requireActiveRole(actor, model, ['owner', 'editor']);
      await this.access.assertSourceReadable(actor, model, workspace);
    }
  }

  private async live(proof: AssetExecutionProof): Promise<LiveTask> {
    if (!proof || !Number.isSafeInteger(proof.taskId) || proof.taskId < 1 || !Number.isSafeInteger(proof.leaseEpoch)
      || proof.leaseEpoch < 1 || typeof proof.capability !== 'string' || !/^[a-f0-9]{64}$/.test(proof.capability)
      || typeof proof.leaseOwner !== 'string' || proof.leaseOwner.length > 500
      || typeof proof.jobId !== 'string' || !/^[a-f0-9-]{36}$/i.test(proof.jobId)) throw new UnauthorizedException('Invalid asset execution proof');
    const digest = createHash('sha256').update(proof.capability).digest('hex');
    const result = await this.database.query<LiveTask>(
      `SELECT t.payload AS command, j.actor_user_id AS actor, j.model_id::text AS model, j.job_type AS "jobType", j.created_at AS "createdAt"
       FROM semantic_jobs.tasks t JOIN semantic_jobs.jobs j ON j.id=t.job_id
       WHERE t.id=$1 AND t.job_id=$2::uuid AND t.lease_epoch=$3 AND t.lease_owner=$4
         AND t.state='running' AND j.state='running' AND t.lease_expires_at>now()
         AND t.payload=j.command AND t.task_key=j.job_type || ':initial'
         AND ((j.job_type='population.run' AND t.task_name='semantic-model-population.run')
           OR (j.job_type='datasource.discovery' AND t.task_name='semantic-model-datasource.discover'))
         AND t.checkpoint->>'assetCapabilityDigest'=$5`,
      [proof.taskId, proof.jobId, proof.leaseEpoch, proof.leaseOwner, digest]);
    if (!result.rows[0]) throw new UnauthorizedException('Asset task lease is no longer live');
    return result.rows[0];
  }

  private async authorize(proof: AssetExecutionProof, workspaceId: string, assetId: string, operation: AssetOperation): Promise<{ source: Source; admission: string }> {
    const task = await this.live(proof);
    const payload = task.command.payload as Record<string, unknown> | undefined;
    const token = payload?.assetAdmission;
    const admission = this.open<Admission>(token as string, 'semantic-asset-admission');
    const created = new Date(task.createdAt).getTime() / 1000;
    // App issuance uses whole seconds; DB creation uses its own transaction clock.
    // Allow at most one second of early creation, never extend signed expiry.
    if (admission.nonce !== proof.jobId || !Number.isSafeInteger(admission.iat) || !Number.isSafeInteger(admission.exp)
      || admission.exp <= admission.iat || admission.exp - admission.iat > 300 || !Number.isFinite(created)
      || created < admission.iat - 1 || created > admission.exp || typeof admission.command !== 'string'
      || payload?.assetCommand !== admission.command) throw new UnauthorizedException('Canonical asset admission mismatch');
    const signed = JSON.parse(admission.command) as Record<string, unknown>;
    const signedPayload = signed.payload as Record<string, unknown>;
    // Full normalized-command equality is enforced at runtime persistence. Recheck
    // the signed execution/source projection here, independently of selector input.
    const stable = (value: unknown): string => JSON.stringify(value, (_key, v: unknown) =>
      v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
    for (const key of ['source', 'options', 'purpose']) {
      if (key in signedPayload && stable(signedPayload[key]) !== stable(payload?.[key]))
        throw new UnauthorizedException('Signed asset command scope changed');
    }
    if (Array.isArray(signedPayload.sources)) {
      const projection = (entries: unknown) => Array.isArray(entries) ? entries.map(entry => ({ source: entry.source, options: entry.options || {} })) : null;
      if (stable(projection(signedPayload.sources)) !== stable(projection(payload?.sources)))
        throw new UnauthorizedException('Signed asset sources changed');
    }
    const expected = task.jobType === 'population.run' ? 'population' : task.jobType === 'datasource.discovery' ? 'discovery' : null;
    if (!expected || admission.purpose !== expected || admission.actor !== task.actor || admission.model !== task.model
      || (expected === 'population' && !admission.model)
      || (expected === 'discovery' && operation === 'derived-put')) throw new UnauthorizedException('Asset operation not admitted');
    const source = admission.sources.find(s => s.workspaceId === workspaceId && s.assetId === assetId);
    if (!source) throw new UnauthorizedException('Asset source not admitted');
    // The immutable admitted command, not request selectors, owns source scope.
    const entries = expected === 'discovery' ? [{ source: payload?.source }] : payload?.sources;
    if (!Array.isArray(entries) || !entries.some((entry: { source?: { workspaceId?: string; assetId?: string } }) =>
      entry.source?.workspaceId === workspaceId && entry.source.assetId === assetId)) throw new UnauthorizedException('Canonical job source mismatch');
    await this.currentAccess(admission.actor, admission.model, workspaceId);
    const doc = await this.documents.findById(workspaceId, assetId);
    if (this.version(doc) !== source.version) throw new UnauthorizedException('Admitted asset content changed');
    return { source, admission: token as string };
  }

  private storageScope(proof: AssetExecutionProof, source: Source, token: string, operation: AssetOperation, target: AssetTarget): { target?: AssetTarget; namespace?: string } {
    if (operation === 'metadata' || operation === 'read') return {};
    if (operation === 'derived-put' ? typeof target.fileName !== 'string' || !/^[^/\\\x00-\x1f]{1,200}$/.test(target.fileName)
      : typeof target.datasetId !== 'string' || !/^ds_[a-f0-9]{24}$/.test(target.datasetId))
      throw new UnauthorizedException('Asset target is required');
    const admission = this.open<Admission>(token, 'semantic-asset-admission');
    const payload = JSON.parse(admission.command).payload as Record<string, unknown>;
    const entries = admission.purpose === 'discovery' ? [{ source: payload.source, options: payload.options }] : payload.sources;
    const canonical = (value: unknown): string => JSON.stringify(value, (_key, v: unknown) =>
      v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
    const scopes = new Map<string, Record<string, unknown>>();
    if (Array.isArray(entries)) for (const entry of entries) {
      if (entry.source?.workspaceId === source.workspaceId && entry.source?.assetId === source.assetId) {
        const options = entry.options || {};
        scopes.set(canonical(options), options);
      }
    }
    const selected = target.options === undefined && scopes.size === 1 ? [...scopes.values()][0] : target.options;
    if (!selected || !scopes.has(canonical(selected))) throw new UnauthorizedException('Options are not an admitted source scope');
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    return { target: { ...(operation === 'derived-put' ? { fileName: target.fileName } : { datasetId: target.datasetId }), options: selected },
      namespace: `v2/${proof.jobId}/${proof.leaseEpoch}/${hash(source.version)}/${hash(canonical(selected))}` };
  }

  async issue(proof: AssetExecutionProof, workspaceId: string, assetId: string, operation: AssetOperation, target: AssetTarget = {}): Promise<{ token: string }> {
    if (!['metadata', 'read', 'derived-put', 'dataset-put', 'dataset-get'].includes(operation)) throw new UnauthorizedException('Invalid asset operation');
    const { source, admission } = await this.authorize(proof, workspaceId, assetId, operation);
    const scope = this.storageScope(proof, source, admission, operation, target);
    return { token: this.seal('semantic-asset-grant', {
      jobId: proof.jobId, taskId: proof.taskId, leaseEpoch: proof.leaseEpoch,
      leaseOwner: proof.leaseOwner, capability: proof.capability,
      ...source, ...scope, admissionDigest: createHash('sha256').update(admission).digest('hex'),
      operation, exp: Math.floor(Date.now() / 1000) + 300,
    } satisfies Grant) };
  }

  async check(token: string, workspaceId: string, assetId: string, operation: AssetOperation, target: AssetTarget = {}): Promise<string> {
    const grant = this.open<Grant>(token, 'semantic-asset-grant');
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(grant.exp) || grant.exp <= now || grant.exp > now + 300 || grant.operation !== operation
      || grant.workspaceId !== workspaceId || grant.assetId !== assetId) throw new UnauthorizedException('Asset grant scope mismatch');
    if (operation === 'derived-put' ? grant.target?.fileName !== target.fileName || !target.fileName
      : operation.startsWith('dataset-') && (grant.target?.datasetId !== target.datasetId || !target.datasetId))
      throw new UnauthorizedException('Asset target does not match grant');
    const checked = await this.authorize(grant, workspaceId, assetId, operation);
    if (createHash('sha256').update(checked.admission).digest('hex') !== grant.admissionDigest
      || checked.source.version !== grant.version) throw new UnauthorizedException('Asset grant admission changed');
    const scope = this.storageScope(grant, checked.source, checked.admission, operation, grant.target || {});
    if (scope.namespace !== grant.namespace) throw new UnauthorizedException('Asset namespace changed');
    return this.open<Admission>(checked.admission, 'semantic-asset-admission').actor;
  }

  storageNamespace(token: string): string {
    const namespace = this.open<Grant>(token, 'semantic-asset-grant').namespace;
    if (!namespace || !/^v2\/[a-f0-9-]{36}\/[1-9][0-9]*\/[a-f0-9]{64}\/[a-f0-9]{64}$/.test(namespace))
      throw new UnauthorizedException('Missing scoped storage namespace');
    return namespace;
  }
}
