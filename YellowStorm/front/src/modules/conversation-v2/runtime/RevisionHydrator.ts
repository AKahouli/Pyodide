import { conversationV2Api } from '../api';
import type { FilesTreeNode } from '../types';
import { isTextSourcePath } from '../utils/app-source';
import { flattenFilesTree } from '../utils/files-tree';

const LOG = '[RevisionHydrator]';

function log(phase: string, details?: Record<string, unknown>) {
  if (details) {
    console.log(`${LOG} [${phase}]`, details);
  } else {
    console.log(`${LOG} [${phase}]`);
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(invalid-url)';
  }
}

export type VfsFiles = Record<string, string | Uint8Array>;

export class RevisionHydrator {
  /**
   * Hydrate Nodepod from an authorized revision (Ceph starter or workspace).
   * Uses revision files + presign APIs — never a client-supplied cephPath.
   */
  async hydrateFromRevision(sessionId: string, revisionId: string): Promise<VfsFiles> {
    log('hydrateFromRevision:start', { sessionId, revisionId });
    const listed = await conversationV2Api.getRevisionFiles(sessionId, revisionId);
    const paths = listed.files.map((f) => f.path);
    if (paths.length === 0) {
      throw new Error(`Revision ${revisionId} has no files`);
    }

    log('presign-revision:request', { sessionId, revisionId, pathCount: paths.length });
    const { items } = await conversationV2Api.presignRevisionFiles(
      sessionId,
      revisionId,
      paths,
    );
    log('presign-revision:response', {
      itemCount: items.length,
      sample: items.slice(0, 3).map((i) => ({ path: i.path, urlHost: safeHost(i.url) })),
    });

    return this.downloadPresignedItems(items);
  }

  /**
   * Download project files from Ceph via legacy prefix + filesTree.
   * Prefer {@link hydrateFromRevision} for new OpenCode sessions.
   */
  async hydrateFromCeph(
    sessionId: string,
    cephPath: string,
    filesTree: FilesTreeNode,
  ): Promise<VfsFiles> {
    const flat = flattenFilesTree(filesTree);
    log('flatten-tree', { fileCount: flat.length, samplePaths: flat.slice(0, 8).map((f) => f.path) });
    if (flat.length === 0) {
      throw new Error('No source files in tree');
    }

    const paths = flat.map((f) => f.path);
    log('presign-urls:request', { sessionId, cephPath, pathCount: paths.length });
    const { items } = await conversationV2Api.getAppSourceUrls(sessionId, cephPath, paths);
    log('presign-urls:response', {
      itemCount: items.length,
      sample: items.slice(0, 3).map((i) => ({ path: i.path, urlHost: safeHost(i.url) })),
    });

    return this.downloadPresignedItems(items);
  }

  /**
   * @deprecated Bundled starter removed — all hydration must come from Ceph.
   */
  hydrateStarter(): VfsFiles {
    throw new Error(
      'Bundled starter hydration is disabled; use hydrateFromRevision against Ceph',
    );
  }

  /**
   * Write/overwrite files into a running Nodepod pod's VFS.
   * Used after `runtime.rehydrate` to bring the pod up to date.
   */
  async syncToRevision(
    pod: {
      fs: {
        writeFile: (path: string, content: string | Uint8Array) => Promise<void>;
        mkdir: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
      };
    },
    files: VfsFiles,
  ): Promise<void> {
    log('syncToRevision:start', { fileCount: Object.keys(files).length });
    const dirs = new Set<string>();
    for (const path of Object.keys(files)) {
      const dir = path.substring(0, path.lastIndexOf('/'));
      if (dir && dir !== '/') dirs.add(dir);
    }
    for (const dir of dirs) {
      try {
        await pod.fs.mkdir(dir, { recursive: true });
      } catch {
        // already exists
      }
    }
    await Promise.all(
      Object.entries(files).map(async ([path, content]) => {
        await pod.fs.writeFile(path, content);
      }),
    );
    log('syncToRevision:done');
  }

  private async downloadPresignedItems(
    items: Array<{ path: string; url: string }>,
  ): Promise<VfsFiles> {
    log('download:start', { itemCount: items.length });
    const files: VfsFiles = {};
    let textCount = 0;
    let binaryCount = 0;
    let skippedCount = 0;

    await Promise.all(
      items.map(async ({ path, url }) => {
        const res = await fetch(url);
        if (!res.ok) {
          const base = path.split('/').pop() ?? path;
          const required = base === 'package.json';
          if (!required) {
            skippedCount += 1;
            log('download:skip', { path, status: res.status });
            return;
          }
          throw new Error(`Failed to download ${path} (${res.status})`);
        }
        const vfsPath = path.startsWith('/') ? path : `/${path}`;
        if (isTextSourcePath(path)) {
          files[vfsPath] = await res.text();
          textCount += 1;
        } else {
          files[vfsPath] = new Uint8Array(await res.arrayBuffer());
          binaryCount += 1;
        }
      }),
    );

    log('download:done', {
      vfsFileCount: Object.keys(files).length,
      textCount,
      binaryCount,
      skippedCount,
      hasPackageJson: typeof files['/package.json'] === 'string',
    });
    return files;
  }
}
