import { AzureStorageBackend, parseAzureAccount, parseAzureAccountUrl } from './azure.backend';

const KEY_CONNECTION =
  'DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=aGVsbG8gd29ybGQ=;EndpointSuffix=core.windows.net';
const ACCOUNT_URL = 'https://acct.blob.core.windows.net';

describe('parseAzureAccountUrl', () => {
  it('reads the account name out of the endpoint host', () => {
    expect(parseAzureAccountUrl(ACCOUNT_URL)).toEqual({ url: ACCOUNT_URL, name: 'acct' });
  });

  it('trims a trailing slash so the SDK gets a clean endpoint', () => {
    expect(parseAzureAccountUrl(`${ACCOUNT_URL}/`).url).toBe(ACCOUNT_URL);
  });

  it('supports a sovereign cloud suffix', () => {
    expect(parseAzureAccountUrl('https://acct.blob.core.chinacloudapi.cn').name).toBe('acct');
  });

  it('rejects a value that is not a URL', () => {
    expect(() => parseAzureAccountUrl('acct')).toThrow(/valid blob endpoint/);
  });
});

describe('parseAzureAccount', () => {
  it('builds the blob endpoint from the account name', () => {
    expect(parseAzureAccount('DefaultEndpointsProtocol=https;AccountName=acct;EndpointSuffix=core.windows.net'))
      .toEqual({ url: ACCOUNT_URL, name: 'acct' });
  });

  it('keeps an account key out of the way of the parsed values', () => {
    // AccountKey is base64 and contains '='; splitting on every '=' would corrupt the map.
    expect(parseAzureAccount(KEY_CONNECTION).name).toBe('acct');
  });

  it('honours an explicit BlobEndpoint, including a sovereign suffix', () => {
    expect(parseAzureAccount('BlobEndpoint=https://acct.blob.core.chinacloudapi.cn/;AccountName=acct')).toEqual({
      url: 'https://acct.blob.core.chinacloudapi.cn',
      name: 'acct',
    });
  });

  it('derives the account name from a BlobEndpoint that carries none', () => {
    expect(parseAzureAccount('BlobEndpoint=https://acct.blob.core.windows.net')).toEqual({
      url: 'https://acct.blob.core.windows.net',
      name: 'acct',
    });
  });

  it('rejects a connection string that names no account', () => {
    expect(() => parseAzureAccount('DefaultEndpointsProtocol=https')).toThrow(/AccountName/);
  });
});

describe('AzureStorageBackend SAS signing', () => {
  const blobUrl = 'https://acct.blob.core.windows.net/documents/report.pdf';

  function backend(useManagedIdentity: boolean) {
    const instance = new AzureStorageBackend({
      // Shared-key access disabled leaves no connection string at all.
      connectionString: useManagedIdentity ? '' : KEY_CONNECTION,
      container: 'documents',
      useManagedIdentity,
      ...(useManagedIdentity ? { accountUrl: ACCOUNT_URL } : {}),
    });
    const generateSasUrl = jest.fn().mockResolvedValue(`${blobUrl}?account-key-sas`);
    const getUserDelegationKey = jest.fn().mockResolvedValue({
      signedObjectId: 'oid', signedTenantId: 'tid', signedStartsOn: '', signedExpiresOn: '',
      signedService: 'b', signedVersion: '2024-11-04', value: 'ZGVsZWdhdGlvbg==',
    });
    Object.assign(instance as unknown as Record<string, unknown>, {
      accountName: 'acct',
      service: { getUserDelegationKey },
      container: { getBlockBlobClient: () => ({ url: blobUrl, generateSasUrl }) },
    });
    return { instance, generateSasUrl, getUserDelegationKey };
  }

  it('refuses managed identity with neither an account URL nor a connection string', async () => {
    const instance = new AzureStorageBackend({
      connectionString: '',
      container: 'documents',
      useManagedIdentity: true,
    });

    await expect(instance.connect()).rejects.toThrow(/AZURE_STORAGE_ACCOUNT_URL/);
  });

  it('signs with the account key when managed identity is off', async () => {
    const { instance, generateSasUrl, getUserDelegationKey } = backend(false);

    const url = await instance.signedUrl('report.pdf', { expirySeconds: 60, write: false });

    expect(url).toBe(`${blobUrl}?account-key-sas`);
    expect(getUserDelegationKey).not.toHaveBeenCalled();
    expect(generateSasUrl).toHaveBeenCalledTimes(1);
  });

  it('signs with a user delegation key when managed identity is on', async () => {
    const { instance, generateSasUrl, getUserDelegationKey } = backend(true);

    const url = await instance.signedUrl('report.pdf', { expirySeconds: 60, write: false });

    expect(generateSasUrl).not.toHaveBeenCalled();
    expect(getUserDelegationKey).toHaveBeenCalledTimes(1);
    expect(url.startsWith(`${blobUrl}?`)).toBe(true);
    expect(url).toContain('sig=');
    // Signed by the delegation key, not the account key: the SAS names the delegated identity.
    expect(url).toContain('skoid=oid');
  });

  it('issues account-key create-only SAS without overwrite permission', async () => {
    const { instance, generateSasUrl } = backend(false);
    await instance.signedUrl('report.pdf', { expirySeconds: 60, write: true, createOnly: true });
    expect(generateSasUrl.mock.calls[0][0].permissions.toString()).toBe('c');
  });

  it('issues delegated create-only SAS without overwrite permission', async () => {
    const { instance } = backend(true);
    const url = await instance.signedUrl('report.pdf', { expirySeconds: 60, write: true, createOnly: true });
    expect(new URL(url).searchParams.get('sp')).toBe('c');
  });

  it('reuses one delegation key across SAS URLs it can outlive', async () => {
    const { instance, getUserDelegationKey } = backend(true);

    await instance.signedUrl('a.pdf', { expirySeconds: 60, write: false });
    await instance.signedUrl('b.pdf', { expirySeconds: 60, write: true });

    expect(getUserDelegationKey).toHaveBeenCalledTimes(1);
  });

  it('renews the delegation key when it cannot outlive the requested SAS', async () => {
    const { instance, getUserDelegationKey } = backend(true);

    await instance.signedUrl('a.pdf', { expirySeconds: 60, write: false });
    // Beyond the cached key's window, so it cannot sign this one.
    await instance.signedUrl('b.pdf', { expirySeconds: 6 * 60 * 60, write: false });

    expect(getUserDelegationKey).toHaveBeenCalledTimes(2);
  });

  it('refuses a SAS that would outlive the 7-day delegation limit', async () => {
    const { instance } = backend(true);

    await expect(
      instance.signedUrl('a.pdf', { expirySeconds: 8 * 24 * 60 * 60, write: false }),
    ).rejects.toThrow(/7-day/);
  });

  it('signs the copy source the same way under managed identity', async () => {
    const { instance, getUserDelegationKey } = backend(true);
    const syncCopyFromURL = jest.fn().mockResolvedValue(undefined);
    Object.assign(instance as unknown as Record<string, unknown>, {
      container: { getBlockBlobClient: () => ({ url: blobUrl, syncCopyFromURL }) },
    });

    await instance.copy('a.pdf', 'b.pdf');

    expect(getUserDelegationKey).toHaveBeenCalledTimes(1);
    expect(syncCopyFromURL).toHaveBeenCalledWith(expect.stringContaining('sig='));
  });
});
