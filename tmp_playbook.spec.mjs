import { test, chromium } from '@playwright/test';

const creds = {
  email: 'agara@yellowsys.fr',
  password: 'Tanit*2013',
  url: 'http://localhost:5173/#/playbooks/6a1570a3ecfd4a185be49463'
};

test('inspect playbook page', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

  await page.goto(creds.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const loginBtn = page.getByRole('button', { name: /log in|sign in|connexion|se connecter/i });
  if (await loginBtn.isVisible().catch(() => false)) {
    await loginBtn.click();
    await page.waitForTimeout(500);

    await page.getByPlaceholder(/email|e-mail|mail/i).fill(creds.email);
    await page.getByPlaceholder(/password|mot de passe|motdepasse/i).fill(creds.password);

    const submit = page.getByRole('button', { name: /submit|log in|connexion|se connecter|sign in/i }).first();
    await (await submit.isVisible().catch(() => false) ? submit : page.getByRole('button').first()).click();
    await page.waitForTimeout(2500);
  }

  await page.screenshot({ path: 'C:/prog/YellowStorm-poc/tmp-playbook-designer.png', fullPage: true });
  const headingCount = (await page.locator('h1,h2,h3,h4').allTextContents()).length;
  console.log('headingCount', headingCount);
  const buttons = await page.locator('button').count();
  console.log('buttonCount', buttons);
  const inputs = await page.locator('input, textarea, select').count();
  console.log('formFieldCount', inputs);

  await browser.close();
});
