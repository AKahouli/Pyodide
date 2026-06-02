import type { TaskArtifact } from '../types';

function stringifyStructuredValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return value;
    }
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

export function getArtifactDisplayContent(artifact: TaskArtifact): string | null {
  return stringifyStructuredValue(artifact.content ?? artifact.metadata?.data);
}

export function getArtifactPreviewContent(artifact: TaskArtifact, maxLength = 500): string | null {
  const content = getArtifactDisplayContent(artifact);
  if (!content) return null;
  return content.length > maxLength ? content.slice(0, maxLength) + '...' : content;
}
