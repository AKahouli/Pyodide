/**
 * Utility for downloading content as files
 */

/**
 * Map of language identifiers to file extensions
 */
const languageExtensions: Record<string, string> = {
  // JavaScript/TypeScript
  js: '.js',
  javascript: '.js',
  ts: '.ts',
  typescript: '.ts',
  jsx: '.jsx',
  tsx: '.tsx',
  mjs: '.mjs',
  cjs: '.cjs',

  // Python
  py: '.py',
  python: '.py',

  // Web
  html: '.html',
  css: '.css',
  scss: '.scss',
  sass: '.sass',
  less: '.less',

  // Data formats
  json: '.json',
  yaml: '.yaml',
  yml: '.yml',
  xml: '.xml',
  csv: '.csv',
  toml: '.toml',

  // Shell
  bash: '.sh',
  sh: '.sh',
  shell: '.sh',
  zsh: '.zsh',
  powershell: '.ps1',
  ps1: '.ps1',
  bat: '.bat',
  cmd: '.cmd',

  // Systems languages
  c: '.c',
  cpp: '.cpp',
  'c++': '.cpp',
  h: '.h',
  hpp: '.hpp',
  rust: '.rs',
  rs: '.rs',
  go: '.go',

  // JVM languages
  java: '.java',
  kotlin: '.kt',
  kt: '.kt',
  scala: '.scala',
  groovy: '.groovy',

  // Other languages
  ruby: '.rb',
  rb: '.rb',
  php: '.php',
  swift: '.swift',
  r: '.r',
  lua: '.lua',
  perl: '.pl',
  haskell: '.hs',
  hs: '.hs',
  elixir: '.ex',
  ex: '.ex',
  clojure: '.clj',
  clj: '.clj',

  // Markup/Config
  md: '.md',
  markdown: '.md',
  dockerfile: '.dockerfile',
  docker: '.dockerfile',
  makefile: '',
  cmake: '.cmake',

  // Database
  sql: '.sql',
  graphql: '.graphql',
  gql: '.graphql',

  // Default
  plaintext: '.txt',
  text: '.txt',
};

/**
 * Get the file extension for a given language
 */
export function getExtensionForLanguage(language: string): string {
  const normalized = language.toLowerCase();
  return languageExtensions[normalized] || '.txt';
}

/**
 * Sanitize a filename to be safe for download
 */
export function sanitizeFilename(filename: string): string {
  // Remove or replace invalid characters
  return filename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') // Invalid chars
    .replace(/^\.+/, '') // Leading dots
    .replace(/\.+$/, '') // Trailing dots
    .replace(/\s+/g, '_') // Spaces to underscores
    .trim()
    || 'download'; // Fallback if empty
}

/**
 * Generate a filename from language and optional provided filename
 */
export function generateFilename(options: {
  filename?: string;
  language?: string;
  defaultName?: string;
}): string {
  const { filename, language, defaultName = 'code' } = options;

  // If filename is provided and looks complete (has extension), use it
  if (filename) {
    const sanitized = sanitizeFilename(filename);
    // Check if it already has an extension
    if (/\.[a-zA-Z0-9]+$/.test(sanitized)) {
      return sanitized;
    }
    // Add extension based on language
    if (language) {
      return sanitized + getExtensionForLanguage(language);
    }
    return sanitized + '.txt';
  }

  // Generate filename from language
  if (language) {
    return defaultName + getExtensionForLanguage(language);
  }

  return defaultName + '.txt';
}

/**
 * Download content as a file
 */
export function downloadAsFile(options: {
  content: string;
  filename: string;
  mimeType?: string;
}): void {
  const { content, filename, mimeType = 'text/plain' } = options;

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

/**
 * Download code with automatic filename generation
 */
export function downloadCode(options: {
  content: string;
  filename?: string;
  language?: string;
  defaultName?: string;
}): void {
  const { content, filename, language, defaultName } = options;

  const finalFilename = generateFilename({ filename, language, defaultName });

  // Determine MIME type based on language
  let mimeType = 'text/plain';
  if (language) {
    const lang = language.toLowerCase();
    if (lang === 'html') mimeType = 'text/html';
    else if (lang === 'css') mimeType = 'text/css';
    else if (lang === 'json') mimeType = 'application/json';
    else if (lang === 'xml') mimeType = 'application/xml';
    else if (['js', 'javascript', 'mjs', 'cjs'].includes(lang)) mimeType = 'text/javascript';
  }

  downloadAsFile({ content, filename: finalFilename, mimeType });
}
