/**
 * Sandbox Manager often returns `ceph_path` as `{bucket}/{userId}/appbuilder/...`.
 * Our DocumentService signs with Bucket=`{bucket}` and Key=`objectKey`, so a leading
 * bucket segment would produce path-style URLs like
 * `https://s3…/{bucket}/{bucket}/{userId}/…` and 404.
 */
export function normalizeAppSourceCephPrefix(cephPath: string, bucket?: string | null): string {
  let prefix = (cephPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
  const bucketName = (bucket || '').replace(/^\/+|\/+$/g, '');
  if (bucketName) {
    const bucketPrefix = `${bucketName}/`;
    if (prefix === bucketName) {
      return '';
    }
    if (prefix.startsWith(bucketPrefix)) {
      prefix = prefix.slice(bucketPrefix.length);
    }
  }
  return prefix;
}
