import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PreviewController } from '../PreviewController';
import { ToolError } from '../ToolError';
import { RuntimeErrorCodes } from '../runtime.types';

function makePod(overrides: Record<string, unknown> = {}) {
  return {
    instanceId: 'pod-1',
    port: (p: number) => `http://localhost/__virtual__/pod-1/${p}/`,
    proxy: { handleRequest: vi.fn().mockResolvedValue({ statusCode: 200 }) },
    inspect: {
      enable: vi.fn().mockResolvedValue(undefined),
      attach: vi.fn(),
      detach: vi.fn(),
      snapshot: vi.fn().mockResolvedValue({
        data: {
          text: 'Hello world',
          console: [{ level: 'warn', args: ['slow render'] }],
          errors: [{ message: 'Boom', stack: 'at App' }],
        },
      }),
      dom: vi.fn().mockResolvedValue({
        data: {
          tag: 'body',
          children: [{ tag: 'h1', id: 'title', text: 'Hello world', children: [] }],
        },
      }),
    },
    ...overrides,
  };
}

/** A DOM-backed iframe whose document we control. */
function makeIframe(html = '<h1 id="title">Hi</h1>'): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.title = 'Preview App';
  doc.body.innerHTML = html;
  return iframe;
}

describe('PreviewController inspection bridge', () => {
  let ctrl: PreviewController;

  beforeEach(() => {
    document.body.innerHTML = '';
    ctrl = new PreviewController();
    ctrl.setPreview('http://localhost/__virtual__/pod-1/5173/', 5173);
  });

  it('enables and attaches the inspector once', async () => {
    const pod = makePod();
    const iframe = makeIframe();
    await ctrl.attachIframe(pod, iframe);
    await ctrl.attachIframe(pod, iframe);

    expect(pod.inspect.enable).toHaveBeenCalledTimes(1);
    expect(pod.inspect.attach).toHaveBeenCalledTimes(1);
    expect(pod.inspect.attach).toHaveBeenCalledWith({ port: 5173, iframe });
    expect(ctrl.hasIframe).toBe(true);
  });

  it('detaches from the inspector', async () => {
    const pod = makePod();
    await ctrl.attachIframe(pod, makeIframe());
    ctrl.detachIframe(pod);
    expect(pod.inspect.detach).toHaveBeenCalledWith(5173);
    expect(ctrl.hasIframe).toBe(false);
  });

  it('returns the contract shape from inspectPreview', async () => {
    const pod = makePod();
    await ctrl.attachIframe(pod, makeIframe());
    const result = await ctrl.inspectPreview(pod);

    expect(Object.keys(result).sort()).toEqual(
      [
        'capabilities',
        'console',
        'domSummary',
        'runtimeErrors',
        'screenshotArtifactId',
        'title',
        'url',
        'visibleText',
      ].sort(),
    );
    expect(result.visibleText).toBe('Hello world');
    expect(result.console).toEqual(['[warn] slow render']);
    expect(result.runtimeErrors).toEqual(['Boom\nat App']);
    expect(result.domSummary).toEqual([
      { tag: 'body', depth: 0 },
      { tag: 'h1', depth: 1, id: 'title', text: 'Hello world' },
    ]);
    expect(result.capabilities).toEqual({ screenshot: false, interaction: true });
    expect(result.screenshotArtifactId).toBeNull();
    expect(ctrl.getCachedHealthyInspect()).toBeNull();
  });

  it('caches a recent healthy inspect snapshot', async () => {
    const pod = makePod();
    await ctrl.attachIframe(pod, makeIframe());
    vi.mocked(pod.inspect.snapshot).mockResolvedValueOnce({
      data: {
        text: 'Hello world',
        console: [],
        errors: [],
      },
    });
    vi.mocked(pod.inspect.dom).mockResolvedValueOnce({
      data: {
        tag: 'body',
        children: [{ tag: 'h1', id: 'title', text: 'Hello world', children: [] }],
      },
    });

    const result = await ctrl.inspectPreview(pod);

    expect(result.runtimeErrors).toEqual([]);
    expect(ctrl.getCachedHealthyInspect()).toEqual(result);
  });

  it('falls back to an HTTP probe when no iframe is attached', async () => {
    const pod = makePod();
    const result = await ctrl.inspectPreview(pod);

    expect(pod.proxy.handleRequest).toHaveBeenCalled();
    expect(pod.inspect.snapshot).not.toHaveBeenCalled();
    expect(result.capabilities.interaction).toBe(false);
    expect(result.runtimeErrors).toHaveLength(1);
    expect(result.runtimeErrors[0]).toMatch(/inspector is not attached/);
    expect(result.visibleText).toBe('');
  });

  it('reports an unreachable preview as a runtime error', async () => {
    const pod = makePod({
      proxy: { handleRequest: vi.fn().mockRejectedValue(new Error('nope')) },
    });
    const result = await ctrl.inspectPreview(pod);
    expect(result.runtimeErrors).toHaveLength(1);
    expect(result.runtimeErrors[0]).toMatch(/preview iframe is not attached/);
  });

  it('tells the model to restart the dev server when no preview URL is set', async () => {
    const missing = new PreviewController();
    const pod = makePod({
      proxy: { handleRequest: vi.fn().mockRejectedValue(new Error('nope')) },
    });
    const result = await missing.inspectPreview(pod);
    expect(result.runtimeErrors[0]).toMatch(/dev server is not running/);
    expect(result.runtimeErrors[0]).toMatch(/dev_server/);
  });

  it('degrades gracefully when an inspector call fails', async () => {
    const pod = makePod();
    pod.inspect.snapshot.mockRejectedValue(new Error('agent gone'));
    await ctrl.attachIframe(pod, makeIframe());

    const result = await ctrl.inspectPreview(pod);
    expect(result.visibleText).toBe('');
    expect(result.domSummary).toHaveLength(2);
  });
});

describe('PreviewController.performAction', () => {
  let ctrl: PreviewController;

  beforeEach(() => {
    document.body.innerHTML = '';
    ctrl = new PreviewController();
    ctrl.setPreview('http://localhost/__virtual__/pod-1/5173/', 5173);
  });

  it('returns UNSUPPORTED_CAPABILITY when no iframe is attached', async () => {
    await expect(ctrl.performAction('click', { selector: 'button' })).rejects.toMatchObject(
      {
        code: RuntimeErrorCodes.UNSUPPORTED_CAPABILITY,
        data: { requiredCapability: 'previewInteraction' },
      },
    );
  });

  it('clicks an element', async () => {
    const pod = makePod();
    const iframe = makeIframe('<button id="go">Go</button>');
    await ctrl.attachIframe(pod, iframe);

    const onClick = vi.fn();
    iframe.contentDocument!.getElementById('go')!.addEventListener('click', onClick);

    await expect(ctrl.performAction('click', { selector: '#go' })).resolves.toEqual({
      ok: true,
      action: 'click',
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('sets an input value and fires input + change', async () => {
    const pod = makePod();
    const iframe = makeIframe('<input id="name" />');
    await ctrl.attachIframe(pod, iframe);

    const events: string[] = [];
    const input = iframe.contentDocument!.getElementById('name') as HTMLInputElement;
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));

    await ctrl.performAction('input', { selector: '#name', value: 'Bader' });
    expect(input.value).toBe('Bader');
    expect(events).toEqual(['input', 'change']);
  });

  it('selects an option', async () => {
    const pod = makePod();
    const iframe = makeIframe(
      '<select id="s"><option value="a">A</option><option value="b">B</option></select>',
    );
    await ctrl.attachIframe(pod, iframe);

    await ctrl.performAction('select', { selector: '#s', value: 'b' });
    const select = iframe.contentDocument!.getElementById('s') as HTMLSelectElement;
    expect(select.value).toBe('b');
  });

  it('dispatches keydown and keyup for press_key', async () => {
    const pod = makePod();
    const iframe = makeIframe('<input id="q" />');
    await ctrl.attachIframe(pod, iframe);

    const keys: string[] = [];
    const input = iframe.contentDocument!.getElementById('q')!;
    input.addEventListener('keydown', (e) => keys.push(`down:${(e as KeyboardEvent).key}`));
    input.addEventListener('keyup', (e) => keys.push(`up:${(e as KeyboardEvent).key}`));

    await ctrl.performAction('press_key', { selector: '#q', value: 'Enter' });
    expect(keys).toEqual(['down:Enter', 'up:Enter']);
  });

  it('scrolls an element into view', async () => {
    const pod = makePod();
    const iframe = makeIframe('<div id="target">x</div>');
    await ctrl.attachIframe(pod, iframe);

    const target = iframe.contentDocument!.getElementById('target')!;
    target.scrollIntoView = vi.fn();

    await expect(ctrl.performAction('scroll', { selector: '#target' })).resolves.toEqual({
      ok: true,
      action: 'scroll',
    });
    expect(target.scrollIntoView).toHaveBeenCalled();
  });

  it('reloads by reassigning src', async () => {
    const pod = makePod();
    const iframe = makeIframe();
    iframe.src = 'about:blank';
    await ctrl.attachIframe(pod, iframe);

    await expect(ctrl.performAction('reload')).resolves.toEqual({
      ok: true,
      action: 'reload',
    });
  });

  it('requires a selector for element actions', async () => {
    const pod = makePod();
    await ctrl.attachIframe(pod, makeIframe());
    await expect(ctrl.performAction('click', {})).rejects.toMatchObject({
      code: RuntimeErrorCodes.INVALID_PARAMS,
    });
  });

  it('reports a missing element as INVALID_PARAMS', async () => {
    const pod = makePod();
    await ctrl.attachIframe(pod, makeIframe());
    const error = await ctrl.performAction('click', { selector: '#nope' }).catch((e) => e);
    expect(error).toBeInstanceOf(ToolError);
    expect(error.code).toBe(RuntimeErrorCodes.INVALID_PARAMS);
  });
});
