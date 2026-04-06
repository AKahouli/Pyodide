import type { ArtifactKind } from '../types';

const EXT_KIND_MAP: Record<string, ArtifactKind> = {
  '.pdf': 'document',
  '.doc': 'document',
  '.docx': 'document',
  '.odt': 'document',
  '.rtf': 'document',
  '.txt': 'text',
  '.md': 'text',
  '.py': 'code',
  '.js': 'code',
  '.ts': 'code',
  '.tsx': 'code',
  '.jsx': 'code',
  '.java': 'code',
  '.kt': 'code',
  '.go': 'code',
  '.rs': 'code',
  '.c': 'code',
  '.cpp': 'code',
  '.h': 'code',
  '.cs': 'code',
  '.rb': 'code',
  '.php': 'code',
  '.sh': 'code',
  '.bat': 'code',
  '.sql': 'code',
  '.r': 'code',
  '.lua': 'code',
  '.swift': 'code',
  '.csv': 'data',
  '.xlsx': 'data',
  '.xls': 'data',
  '.json': 'data',
  '.xml': 'data',
  '.yaml': 'data',
  '.yml': 'data',
  '.tsv': 'data',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.bmp': 'image',
  '.svg': 'image',
  '.webp': 'image',
  '.pptx': 'document',
  '.ppt': 'document',
  '.odp': 'document',
};

const MIME_KIND_MAP: Record<string, ArtifactKind> = {
  'application/pdf': 'document',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/csv': 'data',
  'application/json': 'data',
  'application/xml': 'data',
  'text/xml': 'data',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'data',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'image',
  'image/svg+xml': 'image',
  'image/webp': 'image',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'document',
};

export function inferArtifactKind(
  filename?: string,
  mimeType?: string,
): ArtifactKind | undefined {
  if (filename) {
    const lower = filename.toLowerCase();
    const dotIdx = lower.lastIndexOf('.');
    if (dotIdx !== -1) {
      const ext = lower.slice(dotIdx);
      const kind = EXT_KIND_MAP[ext];
      if (kind) return kind;
    }
  }
  if (mimeType) {
    return MIME_KIND_MAP[mimeType];
  }
  return undefined;
}
