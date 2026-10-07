import { collectTemplateCephKeys } from './template-ceph-cleanup.util';

describe('collectTemplateCephKeys', () => {
  it('dedupes cover, manifests, and blob object keys', () => {
    expect(
      collectTemplateCephKeys(
        { coverImage: 'cover', manifestObjectKey: 'manifest' },
        [
          {
            manifestObjectKey: 'manifest',
            files: [
              { objectKey: 'blobs/a' },
              { objectKey: 'blobs/a' },
              { objectKey: 'blobs/b' },
            ],
          },
          {
            manifestObjectKey: 'manifest-old',
            files: [{ objectKey: 'blobs/b' }],
          },
        ],
      ),
    ).toEqual({
      coverImage: 'cover',
      manifestKeys: ['manifest', 'manifest-old'],
      blobKeys: ['blobs/a', 'blobs/b'],
    });
  });

  it('ignores empty keys', () => {
    expect(
      collectTemplateCephKeys({ coverImage: '', manifestObjectKey: null }, []),
    ).toEqual({ coverImage: '', manifestKeys: [], blobKeys: [] });
  });
});
