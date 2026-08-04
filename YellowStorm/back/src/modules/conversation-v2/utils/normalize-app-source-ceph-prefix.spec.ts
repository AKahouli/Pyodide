import { normalizeAppSourceCephPrefix } from './normalize-app-source-ceph-prefix';

describe('normalizeAppSourceCephPrefix', () => {
  it('strips a leading bucket segment from ceph_path', () => {
    expect(
      normalizeAppSourceCephPrefix(
        'yellowstorm/69f0ac2deb55eb981e92f270/appbuilder/6f2da0a60f3049a8/projectSRC',
        'yellowstorm',
      ),
    ).toBe('69f0ac2deb55eb981e92f270/appbuilder/6f2da0a60f3049a8/projectSRC');
  });

  it('leaves paths that do not start with the bucket unchanged', () => {
    expect(
      normalizeAppSourceCephPrefix(
        '69f0ac2deb55eb981e92f270/appbuilder/conv/projectSRC',
        'yellowstorm',
      ),
    ).toBe('69f0ac2deb55eb981e92f270/appbuilder/conv/projectSRC');
  });

  it('trims slashes and ignores empty bucket', () => {
    expect(normalizeAppSourceCephPrefix('/a/b/projectSRC/', '')).toBe('a/b/projectSRC');
    expect(normalizeAppSourceCephPrefix('/a/b/projectSRC/', null)).toBe('a/b/projectSRC');
  });

  it('does not strip a partial bucket name match', () => {
    expect(
      normalizeAppSourceCephPrefix('yellowstorm-other/user/projectSRC', 'yellowstorm'),
    ).toBe('yellowstorm-other/user/projectSRC');
  });
});
