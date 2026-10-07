export function canOperateStream(isLoaded: boolean, access?: 'owner' | 'write' | 'read'): boolean {
  return isLoaded && access !== 'read';
}
