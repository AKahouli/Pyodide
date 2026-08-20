import * as fs from 'fs';
import * as path from 'path';

const sourcesDir = path.join(__dirname, 'sources');

/** Read a canonical starter source file (valid TypeScript for generated apps). */
export function readStarterSource(filename: string): string {
  return fs.readFileSync(path.join(sourcesDir, filename), 'utf8');
}
