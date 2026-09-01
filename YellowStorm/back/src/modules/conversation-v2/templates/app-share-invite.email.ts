import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { EmailAttachment } from '@modules/email/interfaces/email.interface';

export const APP_SHARE_INVITE_LOGO_CID = 'yellowsys-logo';

const BRAND_YELLOW = '#FAC800';
const BRAND_DARK = '#141414';
const BRAND_CARD = '#1f1f1f';
const BRAND_MUTED = '#a3a3a3';
const YELLOWSYS_WEBSITE_URL = 'https://yellowsys.fr';

function resolveLogoPath(): string | null {
  const candidates = [
    join(__dirname, 'assets', 'yellowsys-logo.svg'),
    join(__dirname, '..', '..', 'app-data', 'templates', 'assets', 'yellowsys-logo.svg'),
    join(process.cwd(), 'src', 'modules', 'app-data', 'templates', 'assets', 'yellowsys-logo.svg'),
    join(process.cwd(), 'dist', 'src', 'modules', 'app-data', 'templates', 'assets', 'yellowsys-logo.svg'),
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

function loadLogoAttachment(): EmailAttachment | null {
  const logoPath = resolveLogoPath();
  if (!logoPath) return null;
  return {
    filename: 'yellowsys-logo.svg',
    content: readFileSync(logoPath),
    contentType: 'image/svg+xml',
    cid: APP_SHARE_INVITE_LOGO_CID,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface AppShareInviteEmailContent {
  subject: string;
  html: string;
  text: string;
  attachments: EmailAttachment[];
}

export function buildAppShareInviteEmail(params: {
  appTitle: string;
  registerUrl: string;
  inviteTtlDays: number;
}): AppShareInviteEmailContent {
  const title = escapeHtml(params.appTitle || 'An app');
  const registerUrl = escapeHtml(params.registerUrl);
  const ttlDays = Math.max(1, params.inviteTtlDays);
  const logo = loadLogoAttachment();
  const logoBlock = logo
    ? `<img src="cid:${APP_SHARE_INVITE_LOGO_CID}" alt="yellowsys" width="48" height="54" style="display:block;border:0;outline:none;text-decoration:none;" />`
    : `<span style="font-size:22px;font-weight:700;color:${BRAND_YELLOW};letter-spacing:-0.02em;">yellowsys</span>`;

  const subject = `${escapeHtml(params.appTitle || 'An app')} — create your account`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND_DARK};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:${BRAND_DARK};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background-color:${BRAND_CARD};border:1px solid #2e2e2e;border-radius:20px;overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 24px;text-align:center;background:linear-gradient(180deg,#242424 0%,${BRAND_CARD} 100%);">
              ${logoBlock}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 0;text-align:center;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND_YELLOW};">Invitation</p>
              <h1 style="margin:0 0 12px;font-size:28px;line-height:1.25;font-weight:700;color:#ffffff;">You&apos;re invited</h1>
              <p style="margin:0 0 6px;font-size:18px;line-height:1.4;font-weight:700;color:#ffffff;">${title}</p>
              <p style="margin:0;font-size:16px;line-height:1.6;color:${BRAND_MUTED};">has been shared with you.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 8px;text-align:center;">
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${BRAND_MUTED};">
                Create your account to get started. Your email will be pre-filled on the registration page.
              </p>
              <a href="${registerUrl}" style="display:inline-block;padding:14px 28px;border-radius:999px;background-color:${BRAND_YELLOW};color:#141414;font-size:16px;font-weight:600;text-decoration:none;">
                Create your account
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 32px;text-align:center;">
              <p style="margin:0;font-size:13px;line-height:1.5;color:#737373;">
                This invitation link expires in ${ttlDays} day${ttlDays === 1 ? '' : 's'}.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#525252;text-align:center;">
          Powered by
          <a href="${YELLOWSYS_WEBSITE_URL}" style="color:${BRAND_YELLOW};font-weight:600;text-decoration:none;">yellowsys</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `You're invited to use ${params.appTitle || 'an app'}.`,
    '',
    `Create your account: ${params.registerUrl}`,
    '',
    `This invitation expires in ${ttlDays} day${ttlDays === 1 ? '' : 's'}.`,
    '',
    `Powered by yellowsys — ${YELLOWSYS_WEBSITE_URL}`,
  ].join('\n');

  return {
    subject,
    html,
    text,
    attachments: logo ? [logo] : [],
  };
}
