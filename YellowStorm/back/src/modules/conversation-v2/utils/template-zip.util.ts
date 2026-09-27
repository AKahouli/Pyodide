import AdmZip = require('adm-zip');
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import {
  TEMPLATE_MAX_ARCHIVE_FILES,
  TEMPLATE_MAX_UNCOMPRESSED_BYTES,
} from '../constants/template-catalog.constants';

export interface TemplateArchiveFile {
  path: string;
  data: Buffer;
}

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.git']);
const EXCLUDED_BASENAMES = new Set(['manifest.json', 'README.md', 'package-lock.json']);

/**
 * Extract the shippable source files from a template ZIP, mirroring the
 * starter publish script's exclusions (build output, locks, source maps).
 * Rejects empty or oversized archives as ERR_3804.
 */
export function extractTemplateArchive(buffer: Buffer): TemplateArchiveFile[] {
  let archive: AdmZip;
  try {
    archive = new AdmZip(buffer);
  } catch {
    throw new BadRequestException(
      ErrorCode.CONVERSATION_V2_TEMPLATE_ZIP_INVALID,
      'The template source is not a valid ZIP archive.',
    );
  }

  const files: TemplateArchiveFile[] = [];
  let totalBytes = 0;

  for (const entry of archive.getEntries()) {
    if (entry.isDirectory) continue;
    const path = entry.entryName.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!path || path.includes('..') || path.includes('\0')) continue;
    const parts = path.split('/');
    if (parts.some((part) => EXCLUDED_DIRS.has(part))) continue;
    const baseName = parts[parts.length - 1];
    if (EXCLUDED_BASENAMES.has(baseName) || baseName.endsWith('.map')) continue;

    const data = entry.getData();
    totalBytes += data.length;
    if (
      files.length + 1 > TEMPLATE_MAX_ARCHIVE_FILES ||
      totalBytes > TEMPLATE_MAX_UNCOMPRESSED_BYTES
    ) {
      throw new BadRequestException(
        ErrorCode.CONVERSATION_V2_TEMPLATE_ZIP_INVALID,
        'The template archive is too large.',
      );
    }
    files.push({ path, data });
  }

  if (files.length === 0) {
    throw new BadRequestException(
      ErrorCode.CONVERSATION_V2_TEMPLATE_ZIP_INVALID,
      'The template archive contains no shippable files.',
    );
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}
