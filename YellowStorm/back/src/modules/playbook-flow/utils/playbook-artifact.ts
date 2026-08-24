import { createHash } from 'crypto';

const PATH_KEYS = new Set([
  'url', 'ref', 'filepath', 'filePath', 'file_path', 'storagePath',
  'storage_path', 'ceph_path', 'object_key', 'objectKey', 'azure_path',
]);
const PUBLIC_LINK_COMPONENT_TYPES = new Set(['sources', 'citation']);
const PUBLIC_LINK_KEYS = new Set(['url', 'ref']);
const OPAQUE_ARTIFACT_ID = /^[a-f0-9]{32}$/;

interface TrustedArtifact {
  artifactId: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  artifactKind: string;
  componentIndex: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeFilename(value: unknown): string {
  const filename = String(value || '').replace(/\\/g, '/').split('/').pop() || 'artifact';
  return filename.replace(/[\r\n"]/g, '').slice(0, 255) || 'artifact';
}

function artifactId(executionId: string, taskId: string, iteration: number, index: number, storagePath: string): string {
  return createHash('sha256')
    .update(`${executionId}:${taskId}:${iteration}:${index}:${storagePath}`)
    .digest('hex')
    .slice(0, 32);
}

export function trustedPlaybookArtifacts(
  taskResult: Record<string, unknown>,
  ownerId: string,
  executionId: string,
): TrustedArtifact[] {
  const prefix = `${ownerId}/system_${executionId}/`;
  const taskId = String(taskResult.taskId || '');
  const iteration = Number(taskResult.iteration || 0);
  const components = Array.isArray(taskResult.components) ? taskResult.components : [];
  const trusted: TrustedArtifact[] = [];

  components.forEach((candidate, index) => {
    const component = asRecord(candidate);
    const data = asRecord(component?.data);
    if (component?.type !== 'artifact' || !data) return;
    const publishedArtifactId = String(data.artifactId || data.artifact_id || '').trim();
    if (OPAQUE_ARTIFACT_ID.test(publishedArtifactId)) {
      trusted.push({
        artifactId: publishedArtifactId,
        storagePath: `${prefix}artifacts/${publishedArtifactId}`,
        filename: safeFilename(data.filename),
        mimeType: String(data.mimeType || data.mime_type || ''),
        artifactKind: String(data.artifact_kind || 'document'),
        componentIndex: index,
      });
      return;
    }
    const rawPath = String(data.object_key || data.file_path || data.ceph_path || '').trim();
    const storagePath = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!storagePath.startsWith(prefix) || storagePath.split('/').some((segment) => segment === '..')) return;
    trusted.push({
      artifactId: artifactId(executionId, taskId, iteration, index, storagePath),
      storagePath,
      filename: safeFilename(data.filename || storagePath),
      mimeType: String(data.mime_type || ''),
      artifactKind: String(data.artifact_kind || 'document'),
      componentIndex: index,
    });
  });
  return trusted;
}

function sanitizeResultText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value
    .replace(/(?:https?:)?\/\/[^\s"'`<>)\]},]+/gi, (url) => (
      /[?&](?:x-amz-[^=&\s]+|awsaccesskeyid|signature|sig)=?/i.test(url) ? '[REDACTED]' : url
    ))
    .replace(/\b(?:s3|ceph|azure):\/\/[^\s"'`<>)\]},]+/gi, '[REDACTED]')
    .replace(/(?:\/mnt\/workspace|\/workspace|\/home\/[^/\s]+)\/[^\s"'`<>)]+/g, '[REDACTED]')
    .replace(/[A-Za-z0-9_-]+\/system_[A-Za-z0-9_-]+\/[^\s"'`<>)\]},]+/g, '[REDACTED]');
}

export function sanitizePlaybookPublicValue(value: unknown, preservePublicLinks = false): unknown {
  if (typeof value === 'string') return sanitizeResultText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizePlaybookPublicValue(item, preservePublicLinks));
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype.constructor?.name !== 'Object') return value;
  }
  const record = asRecord(value);
  if (!record) return value;
  const allowPublicLinks = preservePublicLinks
    || (typeof record.type === 'string' && PUBLIC_LINK_COMPONENT_TYPES.has(record.type));
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !PATH_KEYS.has(key) || (allowPublicLinks && PUBLIC_LINK_KEYS.has(key)))
      .map(([key, nested]) => [key, sanitizePlaybookPublicValue(nested, allowPublicLinks)]),
  );
}

export class PlaybookTokenStreamRedactor {
  private readonly pending = new Map<string, string>();

  push(key: string, chunk: string): string {
    const combined = `${this.pending.get(key) || ''}${chunk}`;
    let lastDelimiter = -1;
    for (let index = 0; index < combined.length; index += 1) {
      if (/[\s"'`<>)\]},\[{:;=]/.test(combined[index])) lastDelimiter = index;
    }
    if (lastDelimiter < 0) {
      this.pending.set(key, combined);
      return '';
    }
    this.pending.set(key, combined.slice(lastDelimiter + 1));
    return String(sanitizePlaybookPublicValue(combined.slice(0, lastDelimiter + 1)));
  }

  flush(key: string): string {
    const pending = this.pending.get(key) || '';
    this.pending.delete(key);
    return String(sanitizePlaybookPublicValue(pending));
  }

  discardExecution(executionId: string): void {
    for (const key of this.pending.keys()) {
      if (key.startsWith(`${executionId}:`)) this.pending.delete(key);
    }
  }
}

export function publicPlaybookTaskResult(
  taskResult: Record<string, unknown>,
  ownerId: string,
  executionId: string,
  verifiedArtifactIds: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
  const trusted = trustedPlaybookArtifacts(taskResult, ownerId, executionId);
  const byComponentIndex = new Map(trusted.map((artifact) => [artifact.componentIndex, artifact]));
  const byFilename = new Map<string, TrustedArtifact[]>();
  trusted.forEach((artifact) => {
    byFilename.set(artifact.filename, [...(byFilename.get(artifact.filename) || []), artifact]);
  });
  const components = Array.isArray(taskResult.components)
    ? taskResult.components.map((candidate, index) => {
      const component = asRecord(sanitizePlaybookPublicValue(candidate)) || {};
      const data = asRecord(component.data);
      if (component.type !== 'artifact' || !data) return component;
      const artifact = byComponentIndex.get(index);
      const { artifactId: _artifactId, artifact_id: _artifactIdSnake, availability: _availability, ...safeData } = data;
      const isVerified = artifact && verifiedArtifactIds.has(artifact.artifactId);
      return {
        ...component,
        data: {
          ...safeData,
          ...(isVerified ? {
            artifactId: artifact.artifactId,
            mimeType: artifact.mimeType,
            availability: 'ready',
          } : {}),
        },
      };
    })
    : [];
  const artifacts = Array.isArray(taskResult.artifacts)
    ? taskResult.artifacts.map((candidate) => {
      const record = asRecord(sanitizePlaybookPublicValue(candidate)) || {};
      const queue = byFilename.get(safeFilename(record.filename)) || [];
      const artifact = queue.shift();
      const { artifactId: _artifactId, artifact_id: _artifactIdSnake, availability: _availability, ...safeRecord } = record;
      const isVerified = artifact && verifiedArtifactIds.has(artifact.artifactId);
      return {
        ...safeRecord,
        ...(isVerified ? {
          artifactId: artifact.artifactId,
          filename: artifact.filename,
          mimeType: artifact.mimeType || safeRecord.mime_type || '',
          availability: 'ready',
        } : {}),
      };
    })
    : [];

  return {
    ...asRecord(sanitizePlaybookPublicValue(taskResult)),
    artifacts,
    components,
  };
}
