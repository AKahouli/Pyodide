/**
 * Build the end-user register invite URL for a deployed app.
 *
 * Deployed URLs always end with `/` (e.g. `https://apps…/apps/{id}/`).
 * Append `register?invite=…` with no extra leading slash — never produce `//register`.
 */
export function buildAppRegisterInviteUrl(deployedUrl: string, inviteToken: string): string {
  const base = `${(deployedUrl || '').trim().replace(/\/+$/, '')}/`;
  return `${base}register?invite=${encodeURIComponent(inviteToken)}`;
}
