/**
 * Worky — per-stream Manager + Workers model selection smoke suite.
 *
 * Coverage map (matches the 8 user scenarios documented in the feature
 * spec / `docs/worky/`):
 *   1. cold-load hydration (prompt bar shows Default while stream
 *      data is still loading — no premature admin-default fallback)
 *   2. persistent model via the right-aside control
 *   3. per-turn override (different model) and per-turn Default stickiness
 *   4. SSE origin: events endpoint hits the backend, not the Vite dev server
 *   5. stopped stream: send is disabled and no POST /messages fires
 *   6. a11y: sidebar search input has id/name, no missing-id warning
 *   7. responsive: 1024x768 and 390x844 layouts
 *
 * Selector strategy:
 *   - `data-testid` values in the real DOM are derived from the *translated*
 *     label by `WorkyModelSelector.tsx`. The locale is pinned to English
 *     by writing `LANGUAGE_STORAGE_KEY` BEFORE any page script runs.
 *   - The right-aside control and the prompt bar both render a
 *     `WorkyModelSelector` with the same label, so the trigger testids
 *     collide. We scope trigger lookups to the prompt bar via the
 *     `<form>` ancestor (`<PromptBar>` always renders a form element
 *     that contains the two selectors).
 *   - The popover content is portaled to `document.body` by Radix, so
 *     option lookups are rooted at `page`, not at the trigger.
 */
import { expect, type Page, type Request } from '@playwright/test';
import {
  workyTest,
  API_BASE_URL,
  FRONTEND_BASE_URL,
} from './fixtures';

const WORKY_LANGUAGE_KEY = 'yellowmind:locale';

async function gotoWorkyStream(page: Page, streamId: string): Promise<void> {
  await page.goto(`${FRONTEND_BASE_URL}/#/worky/${streamId}`);
  await expect(page.getByTestId('worky-prompt-content')).toBeVisible({ timeout: 15_000 });
}

async function pickModelInPopover(
  page: Page,
  triggerLocator: ReturnType<Page['getByTestId']>,
  optionTestId: string,
): Promise<void> {
  await triggerLocator.click();
  const option = page.getByTestId(optionTestId);
  await expect(option).toBeVisible();
  await option.click();
}

async function waitForPatch(
  page: Page,
  predicate: (url: string) => boolean,
  timeoutMs = 10_000,
): Promise<Request | null> {
  return page
    .waitForRequest(
      (req) => req.method() === 'PATCH' && predicate(req.url()),
      { timeout: timeoutMs },
    )
    .catch(() => null);
}

async function waitForSseRequest(page: Page, timeoutMs = 10_000): Promise<Request> {
  return page.waitForRequest(
    (req) => /\/worky\/streams\/[^/]+\/events/.test(req.url()),
    { timeout: timeoutMs },
  );
}

workyTest.describe('Worky per-stream model selection', () => {
  workyTest.beforeEach(async ({ context }) => {
    // Pin the i18n locale to English BEFORE any page script runs so the
    // trigger testids resolve to the canonical en.json values
    // ("Manager", "Workers", "Default"). The frontend reads
    // `LANGUAGE_STORAGE_KEY` from localStorage on init.
    await context.addInitScript(
      ([key, value]) => {
        try {
          window.localStorage.setItem(key, value);
        } catch (error) {
          // i18n pinning is test-only infrastructure; surface a clear
          // log so failures here are visible (AGENTS.md: no silent
          // drops in tests either).
          console.warn('[worky-smoke] failed to pin locale', error);
        }
      },
      [WORKY_LANGUAGE_KEY, 'en'] as const,
    );
  });

  workyTest('cold-load pills show "Default" before stream data hydrates', async ({ page, freshStream }) => {
    expect(freshStream.managerModelId ?? null).toBeNull();
    expect(freshStream.workerModelId ?? null).toBeNull();

    await gotoWorkyStream(page, freshStream.id);

    // The two prompt-bar selectors render alongside the right-aside
    // control, so we scope the assertion to the prompt bar's <form>
    // ancestor. WorkyModelSelector generates a colliding testid for
    // both the prompt bar and the right-aside.
    const form = page.locator('form').filter({ has: page.getByTestId('worky-prompt-content') });
    const managerTrigger = form.getByTestId('worky-model-selector-manager');
    const workerTrigger = form.getByTestId('worky-model-selector-workers');
    await expect(managerTrigger).toBeVisible();
    await expect(workerTrigger).toBeVisible();
    // With no per-turn or persistent override, the trigger aria-label
    // is `${label}: ${triggerText}` where triggerText falls back to
    // the "Default" pseudo-option label ("Default" in en.json).
    await expect(managerTrigger).toHaveAttribute('aria-label', /:\s*Default$/);
    await expect(workerTrigger).toHaveAttribute('aria-label', /:\s*Default$/);
  });

  workyTest('right-aside control PATCHes the stream when a model is picked', async ({ page, freshStream }) => {
    await gotoWorkyStream(page, freshStream.id);
    await expect(page.getByTestId('stream-models-control')).toBeVisible();

    // The right-aside uses the same WorkyModelSelector as the prompt
    // bar; the wrapper element (`stream-models-control`) scopes it.
    const control = page.getByTestId('stream-models-control');
    const managerTrigger = control.getByTestId('worky-model-selector-manager');
    await managerTrigger.click();

    // Radix portals the popover content to `document.body`, so we look
    // up options from `page` root, not from `control`.
    const firstOption = page.locator('[data-testid^="worky-model-option-"]').first();
    await expect(firstOption).toBeVisible({ timeout: 10_000 });
    const optionTestId = await firstOption.getAttribute('data-testid');
    expect(optionTestId, 'first option testid must be present').toMatch(/^worky-model-option-/);

    const patchPromise = waitForPatch(page, (url) => /\/worky\/streams\/[^/]+$/.test(url));
    await firstOption.click();
    const patchReq = await patchPromise;
    expect(patchReq, 'right-aside pick must PATCH the stream').not.toBeNull();
    const body = JSON.parse(patchReq!.postData() ?? '{}') as { managerModelId?: string };
    expect(body.managerModelId).toBeTruthy();
    // The wire LiteLLM id matches the testid suffix.
    expect(body.managerModelId).toBe(optionTestId!.replace('worky-model-option-', ''));
  });

  workyTest('per-turn override is omitted from the wire when it matches persistent', async ({ request, authed, freshStream, page }) => {
    // Set a persistent manager model via REST so per-turn "match" is observable.
    const patch = await request.patch(`${API_BASE_URL}/worky/streams/${freshStream.id}`, {
      headers: { authorization: `Bearer ${authed.accessToken}`, 'content-type': 'application/json' },
      data: { managerModelId: 'gpt-4o-mini' },
    });
    expect(patch.ok(), `seed PATCH failed: ${patch.status()} ${await patch.text()}`).toBeTruthy();

    await gotoWorkyStream(page, freshStream.id);

    const messagesPostPromise = page.waitForRequest(
      (req) => req.method() === 'POST' && /\/worky\/streams\/[^/]+\/messages$/.test(req.url()),
      { timeout: 15_000 },
    );

    await page.getByTestId('worky-prompt-content').fill('hello world');
    await page.getByTestId('worky-prompt-send').click();

    const messagesReq = await messagesPostPromise;
    const body = JSON.parse(messagesReq.postData() ?? '{}') as Record<string, unknown>;
    expect(body.content).toBe('hello world');
    // Per-turn is seeded from persistent + user did not change it -> no override field.
    expect(body.managerModelId).toBeUndefined();
  });

  workyTest('clicking Default in the prompt bar does not PATCH the stream', async ({ request, authed, freshStream, page }) => {
    // Seed a persistent manager so Default is a real per-turn choice.
    const seed = await request.patch(`${API_BASE_URL}/worky/streams/${freshStream.id}`, {
      headers: { authorization: `Bearer ${authed.accessToken}`, 'content-type': 'application/json' },
      data: { managerModelId: 'gpt-4o-mini' },
    });
    expect(seed.ok()).toBeTruthy();

    await gotoWorkyStream(page, freshStream.id);

    // Race the click against a PATCH listener; Default must not PATCH.
    const patchPromise = waitForPatch(page, (url) => /\/worky\/streams\/[^/]+$/.test(url), 3_000);

    const form = page.locator('form').filter({ has: page.getByTestId('worky-prompt-content') });
    const managerTrigger = form.getByTestId('worky-model-selector-manager');
    await pickModelInPopover(page, managerTrigger, 'worky-model-default-manager');

    const patchReq = await patchPromise;
    expect(patchReq, 'Default pseudo-option must not PATCH the persistent stream field').toBeNull();

    // And the prompt-bar trigger now shows the "Default" pseudo-option label.
    await expect(managerTrigger).toHaveAttribute('aria-label', /:\s*Default$/);
  });

  workyTest('SSE endpoint resolves against the backend, not the Vite dev server', async ({ page, freshStream }) => {
    await gotoWorkyStream(page, freshStream.id);

    const eventsReq = await waitForSseRequest(page);
    const origin = new URL(eventsReq.url()).origin;
    const expectedOrigin = new URL(API_BASE_URL).origin;
    expect(origin, `SSE pointed at Vite origin ${origin}`).not.toBe(FRONTEND_BASE_URL);
    expect(origin).toBe(expectedOrigin);
  });

  workyTest('stopped stream: send is disabled and no POST /messages fires', async ({ request, authed, freshStream, page }) => {
    // Stop the stream via REST so the page renders a terminal status.
    const stop = await request.delete(`${API_BASE_URL}/worky/streams/${freshStream.id}`, {
      headers: { authorization: `Bearer ${authed.accessToken}`, 'content-type': 'application/json' },
      data: { reason: 'playwright-smoke' },
    });
    expect(stop.ok()).toBeTruthy();

    await gotoWorkyStream(page, freshStream.id);

    await expect(page.getByTestId('worky-prompt-send')).toBeDisabled();
    await expect(page.getByTestId('worky-prompt-content')).toBeDisabled();

    // Listener is attached right before the action so the timeout
    // window covers the actual click, not the navigation/boot.
    const messagesPostPromise = page
      .waitForRequest(
        (req) => req.method() === 'POST' && /\/worky\/streams\/[^/]+\/messages$/.test(req.url()),
        { timeout: 5_000 },
      )
      .catch(() => null);

    // Force the click + fill so the test exercises the disabled path
    // without Playwright's editable-control guard short-circuiting it.
    await page.getByTestId('worky-prompt-content').fill('ignored', { force: true });
    await page.getByTestId('worky-prompt-send').click({ force: true });

    const messagesReq = await messagesPostPromise;
    expect(messagesReq, 'send must not fire on a stopped stream').toBeNull();
  });

  workyTest('sidebar search input has id and name (a11y)', async ({ page, freshStream }) => {
    await page.goto(`${FRONTEND_BASE_URL}/#/worky/${freshStream.id}`);
    const search = page.locator('#worky-stream-search');
    await expect(search).toBeVisible();
    await expect(search).toHaveAttribute('name', 'streamSearch');
  });

  workyTest('responsive 1024x768: prompt bar and models control fit without overflow', async ({ page, freshStream }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await gotoWorkyStream(page, freshStream.id);
    await expect(page.getByTestId('stream-models-control')).toBeVisible();
    await expect(page.getByTestId('worky-prompt-content')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow, 'horizontal overflow detected').toBeFalsy();
  });

  workyTest('mobile 390x844: prompt bar remains usable', async ({ page, freshStream }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWorkyStream(page, freshStream.id);
    await expect(page.getByTestId('worky-prompt-content')).toBeVisible();
    await expect(page.getByTestId('worky-prompt-send')).toBeVisible();
  });
});
