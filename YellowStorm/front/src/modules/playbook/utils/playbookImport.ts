import { PLAYBOOK_DEFINITION_VERSION, type PlaybookDefinitionExport } from '../types';

export class PlaybookImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaybookImportError';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateTaskStructure(task: unknown, index: number): string | null {
  if (!isObject(task)) return `Task at index ${index} is not an object`;
  if (typeof task.id !== 'string') return `Task at index ${index} missing "id"`;
  if (typeof task.title !== 'string') return `Task at index ${index} missing "title"`;
  return null;
}

export function validatePlaybookDefinition(value: unknown): PlaybookDefinitionExport {
  if (!isObject(value)) {
    throw new PlaybookImportError('File does not contain a valid JSON object.');
  }

  if (value.version !== PLAYBOOK_DEFINITION_VERSION) {
    throw new PlaybookImportError(
      `Unsupported playbook definition version: ${value.version}. Expected version ${PLAYBOOK_DEFINITION_VERSION}.`,
    );
  }

  if (typeof value.name !== 'string' || !value.name.trim()) {
    throw new PlaybookImportError('Playbook definition must have a non-empty "name" field.');
  }

  if (!Array.isArray(value.tasks)) {
    throw new PlaybookImportError('Playbook definition must have a "tasks" array.');
  }

  if (!Array.isArray(value.edges)) {
    throw new PlaybookImportError('Playbook definition must have an "edges" array.');
  }

  for (let i = 0; i < value.tasks.length; i++) {
    const error = validateTaskStructure(value.tasks[i], i);
    if (error) throw new PlaybookImportError(error);
  }

  for (let i = 0; i < (value.edges as unknown[]).length; i++) {
    const edge = (value.edges as unknown[])[i];
    if (!isObject(edge)) {
      throw new PlaybookImportError(`Edge at index ${i} is not an object.`);
    }
  }

  return value as unknown as PlaybookDefinitionExport;
}

export async function readPlaybookDefinitionFile(file: File): Promise<PlaybookDefinitionExport> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        const validated = validatePlaybookDefinition(parsed);
        resolve(validated);
      } catch (err) {
        if (err instanceof PlaybookImportError) {
          reject(err);
        } else {
          reject(new PlaybookImportError('File does not contain valid JSON.'));
        }
      }
    };
    reader.onerror = () => {
      reject(new PlaybookImportError('Failed to read file.'));
    };
    reader.readAsText(file);
  });
}
