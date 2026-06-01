const { chromium } = require('playwright');

(async()=>{
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  page.on('console', msg => {
    console.log('[console]', msg.type(), msg.text());
  });
  page.on('pageerror', err => {
    console.log('[pageerror]', err.message);
  });

  const url = 'http://localhost:5173/#/playbooks/6a1570a3ecfd4a185be49463';
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const loginOpen = await page.getByRole('button', { name: /log in|sign in|connexion|login/i }).isVisible().catch(()=>false);
  console.log('loginButtonVisible', loginOpen);

  if (loginOpen) {
    await page.getByRole('button', { name: /log in|sign in|connexion|login/i }).click();
    await page.waitForTimeout(700);
    await page.getByPlaceholder(/email|e-mail|mail/i).fill('agara@yellowsys.fr');
    await page.getByPlaceholder(/password|mot de passe|motdepasse/i).fill('Tanit*2013');
    const submit = page.getByRole('button', { name: /submit|log in|connexion|sign in|se connecter/i }).first();
    if (await submit.isVisible().catch(()=>false)) {
      await submit.click();
    } else {
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(2500);
  }

  console.log('finalUrl', page.url());

  const path = 'C:/prog/YellowStorm-poc/tmp-playbook-designer.png';
  await page.screenshot({ path, fullPage: true });
  console.log('screenshot', path);

  const headings = await page.locator('h1,h2,h3,h4').allTextContents();
  console.log('headingCount', headings.length);
  console.log('headings', headings.slice(0,20).join(' | '));

  const buttons = await page.locator('button').count();
  console.log('buttonCount', buttons);

  const inputs = await page.locator('input, textarea, select').count();
  console.log('formFieldCount', inputs);

  const errorVisible = await page.getByText(/error|invalid|failed|mot de passe|incorrect/i).first().isVisible().catch(()=>false);
  console.log('hasErrorText', errorVisible);

  await browser.close();
})();
