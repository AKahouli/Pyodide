import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLATFORM_KIT_FILES } from './platform-kit';

const BACK_ROOT = join(__dirname, '..', '..', '..', '..');

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(BACK_ROOT, file), 'utf8')) as Record<string, unknown>;
}

/**
 * Guards the dist layout contract that `readPlatformKitFile` depends on.
 *
 * Kit sources are read with a `__dirname`-relative path, so they must land in
 * the same `dist` tree as the compiled modules. `tsc` derives its output root
 * from the common directory of the compiled inputs, which silently changed
 * whenever a root-level `.ts` file (e.g. `drizzle.config.ts`) entered or left
 * the program: local builds emitted `dist/src/**` while the Docker build, which
 * never copies that file, emitted `dist/**`. Nothing tied the two together, so
 * the kit assets stayed behind in `dist/src` and `/deploy` returned 500 in
 * production only.
 */
describe('platform kit dist layout', () => {
  const nestCli = readJson('nest-cli.json');
  const tsconfigBuild = readJson('tsconfig.build.json');
  const pkg = readJson('package.json');

  const nestCompiler = nestCli.compilerOptions as Record<string, unknown>;
  const buildCompiler = tsconfigBuild.compilerOptions as Record<string, unknown> | undefined;
  const scripts = pkg.scripts as Record<string, string>;
  const rawAssets = nestCompiler.assets as unknown[];

  const assets: { include?: string; outDir?: string }[] = rawAssets.filter(
    (asset): asset is { include?: string; outDir?: string } =>
      typeof asset === 'object' && asset !== null,
  );

  it('pins rootDir so the emitted tree does not depend on incidental inputs', () => {
    expect(buildCompiler?.rootDir).toBe('./src');
  });

  it('runs the entry point that rootDir produces', () => {
    expect(scripts['start:prod']).toMatch(/dist\/main(\.js)?$/);
  });

  it.each(['modules/app-data/templates/sources/**/*', 'modules/app-data/templates/assets/**/*'])(
    'copies %s next to the compiled modules',
    (include) => {
      const entry = assets.find((asset) => asset.include === include);
      expect(entry).toBeDefined();
      expect(entry?.outDir).toBe('dist');
    },
  );

  it.each(
    PLATFORM_KIT_FILES.filter((file) => file.source !== null).map((file) => file.source as string),
  )('has kit source %s in the tree the assets are copied from', (source) => {
    const inSourceTree = join(
      BACK_ROOT,
      'src',
      'modules',
      'app-data',
      'templates',
      'sources',
      source,
    );
    expect(existsSync(inSourceTree)).toBe(true);
  });
});
