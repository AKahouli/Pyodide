/**
 * Renderer Registry
 * Maps MIME types to renderer components
 */

import React, { lazy } from 'react';
import { TextRenderer } from './TextRenderer';
import { ImageRenderer } from './ImageRenderer';
import { PptxRenderer } from './PptxRenderer';
import { SpreadsheetRenderer } from './SpreadsheetRenderer';
import { DocxRenderer } from './DocxRenderer';

// The PDF stack (@embedpdf + pdfjs) is the heaviest renderer; load it only
// when a PDF is actually opened (Phase 7 lazy boundary).
const PdfRenderer = lazy(() => import('./PdfRenderer').then((m) => ({ default: m.PdfRenderer })));

const RENDERER_MAP: Record<string, React.ComponentType<any>> = {
  // Word
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': DocxRenderer,
  'application/vnd.ms-word.document.macroEnabled.12': DocxRenderer,
  // PPTX
  'application/vnd.ms-powerpoint': PptxRenderer,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': PptxRenderer,

  // PDF
  'application/pdf': PdfRenderer,
  // Spreadsheets
  'application/vnd.ms-excel': SpreadsheetRenderer,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': SpreadsheetRenderer,
  'application/vnd.ms-excel.sheet.macroenabled.12': SpreadsheetRenderer,
  'application/vnd.ms-excel.sheet.binary.macroEnabled.12': SpreadsheetRenderer,
  'text/csv': SpreadsheetRenderer,

  // Images
  'image/png': ImageRenderer,
  'image/jpeg': ImageRenderer,
  'image/gif': ImageRenderer,
  'image/webp': ImageRenderer,
  'image/svg+xml': ImageRenderer,
  'image/bmp': ImageRenderer,
  'image/avif': ImageRenderer,

  // Text / Code
  'text/plain': TextRenderer,
  'text/markdown': TextRenderer,
  'text/css': TextRenderer,
  'text/html': TextRenderer,
  'text/xml': TextRenderer,
  'text/yaml': TextRenderer,
  'text/javascript': TextRenderer,
  'text/typescript': TextRenderer,
  'text/x-python': TextRenderer,
  'application/json': TextRenderer,
  'application/xml': TextRenderer,
  'application/javascript': TextRenderer,
  'application/typescript': TextRenderer,
};

const EXT_TO_MIME: Record<string, string> = {
  // Word
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  docm: 'application/vnd.ms-word.document.macroEnabled.12',
  // PDF
  pdf: 'application/pdf',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroenabled.12',
  xlsb: 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  // Text / Code
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  mdx: 'text/markdown',
  csv: 'text/csv',
  css: 'text/css',
  html: 'text/html',
  htm: 'text/html',
  xml: 'text/xml',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  js: 'text/javascript',
  jsx: 'text/javascript',
  mjs: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  py: 'text/x-python',
  json: 'application/json',
  jsonc: 'application/json',
  // Additional text types (rendered as plain text)
  sh: 'text/plain',
  bash: 'text/plain',
  zsh: 'text/plain',
  sql: 'text/plain',
  graphql: 'text/plain',
  gql: 'text/plain',
  toml: 'text/plain',
  ini: 'text/plain',
  env: 'text/plain',
  dockerfile: 'text/plain',
  makefile: 'text/plain',
  rs: 'text/plain',
  go: 'text/plain',
  java: 'text/plain',
  kt: 'text/plain',
  swift: 'text/plain',
  c: 'text/plain',
  cpp: 'text/plain',
  h: 'text/plain',
  hpp: 'text/plain',
  cs: 'text/plain',
  php: 'text/plain',
  rb: 'text/plain',
  lua: 'text/plain',
  r: 'text/plain',
  dart: 'text/plain',
  vue: 'text/plain',
  svelte: 'text/plain',
  astro: 'text/plain',
  scss: 'text/plain',
  sass: 'text/plain',
  less: 'text/plain',
};

/**
 * Get the renderer component for a given MIME type.
 * Returns null if no renderer is available.
 */
export function getRenderer(mimeType: string): React.ComponentType<any> | null {
  return RENDERER_MAP[mimeType] ?? null;
}

/**
 * Check if a file type can be previewed in the file viewer.
 */
export function isViewableFile(mimeType: string): boolean {
  return mimeType in RENDERER_MAP;
}

/**
 * Get MIME type from a filename's extension.
 * Returns null if the extension is not recognized as viewable.
 */
export function getMimeTypeFromFilename(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_MIME[ext] ?? null;
}

/**
 * Check if a file can be previewed based on its filename.
 */
export function isViewableFilename(filename: string): boolean {
  const mime = getMimeTypeFromFilename(filename);
  return mime !== null && isViewableFile(mime);
}

export { PdfRenderer } from './PdfRenderer';
export { TextRenderer } from './TextRenderer';
export { ImageRenderer } from './ImageRenderer';
export { PptxRenderer } from './PptxRenderer';
export { SpreadsheetRenderer } from './SpreadsheetRenderer';
export { DocxRenderer } from './DocxRenderer';
export { UnsupportedRenderer } from './UnsupportedRenderer';
