/**
 * Canonical React/Vite starter revision seeded in Ceph.
 * Manifest: appbuilder/manifests/_system/starter_react_vite_v1.json
 * Blobs:    appbuilder/blobs/sha256/<aa>/<fullsha>
 *
 * Keep in sync with the Ceph objects — used as an offline/test fallback when
 * the system manifest cannot be downloaded.
 */
export const STARTER_REACT_VITE_V1_REVISION_ID = 'starter_react_vite_v1';

export const STARTER_REACT_VITE_V1_MANIFEST_KEY =
  'appbuilder/manifests/_system/starter_react_vite_v1.json';

export interface StarterManifestFile {
  path: string;
  sha256: string;
  objectKey: string;
  size: number;
}

export const STARTER_REACT_VITE_V1_FILES: readonly StarterManifestFile[] = [
  {
    path: 'package.json',
    sha256: 'b93904414086eacd9d9b4eca69f945ba6fa6bdcdab768c0ad853717482b9b370',
    objectKey:
      'appbuilder/blobs/sha256/b9/b93904414086eacd9d9b4eca69f945ba6fa6bdcdab768c0ad853717482b9b370',
    size: 316,
  },
  {
    path: 'vite.config.js',
    sha256: 'c5ac000d65adcb7fc7d641e09e067588db3e3e3773af5006c8c499b915656fae',
    objectKey:
      'appbuilder/blobs/sha256/c5/c5ac000d65adcb7fc7d641e09e067588db3e3e3773af5006c8c499b915656fae',
    size: 129,
  },
  {
    path: 'index.html',
    sha256: 'f5143b79142247a44ffc5b0d6e1e7453f039e0031718abd75887d9101960c645',
    objectKey:
      'appbuilder/blobs/sha256/f5/f5143b79142247a44ffc5b0d6e1e7453f039e0031718abd75887d9101960c645',
    size: 300,
  },
  {
    path: 'src/main.jsx',
    sha256: '7f0606a521648451c45958a9a0403148fa91eef6bfc63cd234c991cddda70c53',
    objectKey:
      'appbuilder/blobs/sha256/7f/7f0606a521648451c45958a9a0403148fa91eef6bfc63cd234c991cddda70c53',
    size: 219,
  },
  {
    path: 'src/App.jsx',
    sha256: 'f5098527a3454c9eedb795710221e60b6ace532ed9355a478761c70fa4d87f50',
    objectKey:
      'appbuilder/blobs/sha256/f5/f5098527a3454c9eedb795710221e60b6ace532ed9355a478761c70fa4d87f50',
    size: 132,
  },
  {
    path: 'src/App.css',
    sha256: 'ae8c85b1ea210444b5e73a3ec98f072129c473e2281232952ec60f4f4e5f979e',
    objectKey:
      'appbuilder/blobs/sha256/ae/ae8c85b1ea210444b5e73a3ec98f072129c473e2281232952ec60f4f4e5f979e',
    size: 80,
  },
] as const;
