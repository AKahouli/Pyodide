const STYLE_URLS = ['https://cdn.jsdelivr.net/gh/meshesha/PPTXjs/css/pptxjs.css', 'https://cdn.jsdelivr.net/gh/meshesha/PPTXjs/css/nv.d3.min.css'];

const SCRIPT_URLS = ['https://cdn.jsdelivr.net/gh/meshesha/PPTXjs/js/jquery-1.11.3.min.js', 'https://cdn.jsdelivr.net/gh/meshesha/PPTXjs/js/jszip.min.js', 'https://cdn.jsdelivr.net/gh/meshesha/PPTXjs/js/filereader.js', 'https://cdn.jsdelivr.net/gh/meshesha/PPTXjs/js/d3.min.js', 'https://cdn.jsdelivr.net/gh/meshesha/PPTXjs/js/nv.d3.min.js', 'https://cdn.jsdelivr.net/gh/meshesha/PPTXjs/js/dingbat.js', 'https://cdn.jsdelivr.net/gh/meshesha/PPTXjs/js/pptxjs.min.js'];
const NATIVE_DEFINE_PROPERTY = Object.defineProperty;

let assetPromise: Promise<void> | null = null;

function restoreDefineProperty() {
  if (Object.defineProperty !== NATIVE_DEFINE_PROPERTY) {
    (Object as any).defineProperty = NATIVE_DEFINE_PROPERTY;
  }
}

function loadStylesheet(href: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`link[data-pptx-style="${href}"]`) || document.querySelector(`link[href="${href}"]`)) {
      resolve();
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.pptxStyle = href;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Failed to load style ${href}`));
    document.head.appendChild(link);
  });
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-pptx-script="${src}"]`) || document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset.pptxScript = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script ${src}`));
    document.body.appendChild(script);
  });
}

export function ensurePptxAssets(): Promise<void> {
  if (assetPromise) {
    restoreDefineProperty();
    return assetPromise;
  }

  assetPromise = (async () => {
    for (const href of STYLE_URLS) {
      await loadStylesheet(href);
    }

    for (const src of SCRIPT_URLS) {
      await loadScript(src);
    }

    const win = globalThis.window;
    if (win?.jQuery && !win?.$) {
      win.$ = win.jQuery;
    }

    restoreDefineProperty();
  })();

  return assetPromise;
}

declare global {
  interface Window {
    jQuery?: any;
    $?: any;
  }
}
