/** Content-addressed Ceph key: `appbuilder/blobs/sha256/<aa>/<fullsha>`. */
export function blobObjectKey(sha256: string): string {
  return `appbuilder/blobs/sha256/${sha256.slice(0, 2)}/${sha256}`;
}
