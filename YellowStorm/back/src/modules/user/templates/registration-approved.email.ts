function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface RegistrationApprovedEmailParams {
  appName: string;
  loginUrl: string;
}

export interface RegistrationApprovedEmailContent {
  subject: string;
  html: string;
  text: string;
}

export function buildLoginUrl(frontendUrl: string): string {
  const base = frontendUrl.replace(/\/$/, '');
  return `${base}/#/`;
}

export function buildRegistrationApprovedEmail(
  params: RegistrationApprovedEmailParams,
): RegistrationApprovedEmailContent {
  const appName = escapeHtml(params.appName);

  return {
    subject: `Your account has been approved - ${params.appName}`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Account Approved</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">${appName}</h1>
  </div>
  <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #333; margin-top: 0;">Your account is now active</h2>
    <p>A Super Admin has approved your registration. You can sign in to ${appName}.</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.loginUrl}" style="background: #16a34a; color: white; padding: 14px 28px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Sign in</a>
    </div>
    <p style="color: #666; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
    <p style="color: #667eea; font-size: 14px; word-break: break-all;">${params.loginUrl}</p>
    <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">If you have not verified your email yet, complete verification before signing in.</p>
  </div>
</body>
</html>`,
    text: `
Your account is now active

A Super Admin has approved your registration. You can sign in to ${params.appName}.

Sign in: ${params.loginUrl}

If you have not verified your email yet, complete verification before signing in.
`,
  };
}
