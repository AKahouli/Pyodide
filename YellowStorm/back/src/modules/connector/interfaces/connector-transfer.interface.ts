export interface ConnectorTransferAdapter {
  readonly provider: string;

  downloadItem(
    itemRef: Record<string, unknown>,
    authHeaders: Record<string, string>,
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string }>;

  uploadItem(
    targetRef: Record<string, unknown>,
    authHeaders: Record<string, string>,
    content: Buffer,
    filename: string,
    mimeType: string,
    mode: 'create' | 'update',
  ): Promise<{ itemId: string; name: string; webUrl?: string }>;
}
