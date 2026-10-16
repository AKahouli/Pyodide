import { buildAppRootReexport, buildEntrySource, DEFAULT_APP_ROOT } from '../platform-defaults';

const CSS_IMPORT_RE = /^import\s+['"]([^'"]+\.(?:css|scss|sass|less))['"];?\s*$/gm;
const RENDER_ROOT_RE = /\.render\(\s*(?:<([A-Z][A-Za-z0-9_]*)|[\s\S]{0,200}?<([A-Z][A-Za-z0-9_]*))/;
export interface EntryTransformResult {
  content: string;
  changed: boolean;
  /** Component the template used to render, when one could be detected. */
  detectedRoot: { name: string; importPath: string } | null;
}

/** Rewrite the Vite entry so it mounts the platform router. */
export function transformAppEntry(
  source: string | null,
  fallbackStylesheet: string | null = null,
): EntryTransformResult {
  const fallbackImport = fallbackStylesheet ? [`import '${fallbackStylesheet}';`] : [];
  if (source === null) {
    return { content: buildEntrySource(fallbackImport), changed: true, detectedRoot: null };
  }

  const found = Array.from(source.matchAll(CSS_IMPORT_RE)).map((match) => match[0].trim());
  const cssImports = found.length ? found : fallbackImport;
  const detectedRoot = detectRenderedRoot(source);
  const content = buildEntrySource(cssImports);
  return { content, changed: source.trim() !== content.trim(), detectedRoot };
}

function detectRenderedRoot(source: string): { name: string; importPath: string } | null {
  const match = RENDER_ROOT_RE.exec(source);
  const name = match?.[1] ?? match?.[2];
  if (!name || name === 'StrictMode' || name === 'AppRouter') {
    const appImport = findImport(source, 'App');
    return appImport ? { name: 'App', importPath: appImport } : null;
  }
  const importPath = findImport(source, name);
  return importPath ? { name, importPath } : null;
}

function findImport(source: string, name: string): string | null {
  const re = new RegExp(`import\\s+${name}\\s+from\\s+['"]([^'"]+)['"]`);
  return re.exec(source)?.[1] ?? null;
}

export interface AppRootPlan {
  path: string;
  content: string | null;
  violation: string | null;
  warning: string | null;
}

/**
 * Guarantee a `src/App` default export for the platform router to mount. When
 * the template already has one we only strip its own router, otherwise we
 * create a root that re-exports the component the entry used to render.
 */
export function planAppRoot(input: {
  existingPath: string | null;
  existingSource: string | null;
  detectedRoot: { name: string; importPath: string } | null;
}): AppRootPlan {
  if (input.existingPath && input.existingSource !== null) {
    const stripped = stripOwnRouter(input.existingSource);
    return {
      path: input.existingPath,
      content: stripped.changed ? stripped.content : null,
      violation: stripped.violation,
      warning: null,
    };
  }

  if (input.detectedRoot && !isAppRootPath(input.detectedRoot.importPath)) {
    return {
      path: 'src/App.jsx',
      content: buildAppRootReexport(
        toAppRelativeImport(input.detectedRoot.importPath),
        input.detectedRoot.name,
      ),
      violation: null,
      warning: `Created src/App.jsx re-exporting ${input.detectedRoot.name} from the template entry.`,
    };
  }

  return {
    path: 'src/App.jsx',
    content: DEFAULT_APP_ROOT,
    violation: null,
    warning: 'No template root component detected; a placeholder src/App.jsx was created.',
  };
}

function isAppRootPath(importPath: string): boolean {
  return /(^|\/)App(\.[jt]sx?)?$/.test(importPath);
}

/** Entry imports are relative to `src`, and so is the generated `src/App.jsx`. */
function toAppRelativeImport(importPath: string): string {
  return importPath.replace(/\.(jsx|tsx|js|ts)$/, '');
}

const BROWSER_ROUTER_OPEN_RE = /<BrowserRouter\b[^>]*>/;
const BROWSER_ROUTER_SELF_CLOSING_RE = /<BrowserRouter\b[^>]*\/>/;
const DATA_ROUTER_RE = /createBrowserRouter|createHashRouter|RouterProvider/;

export interface RouterStripResult {
  content: string;
  changed: boolean;
  violation: string | null;
}

/**
 * The platform owns the single `BrowserRouter`. A template that mounts its own
 * would nest routers and break deploy sub-path routing.
 */
export function stripOwnRouter(source: string): RouterStripResult {
  if (DATA_ROUTER_RE.test(source)) {
    return {
      content: source,
      changed: false,
      violation:
        'src/App uses a data router (createBrowserRouter/RouterProvider). The platform already provides BrowserRouter — replace it with plain <Routes>/<Route> elements.',
    };
  }

  if (BROWSER_ROUTER_SELF_CLOSING_RE.test(source)) {
    return {
      content: source,
      changed: false,
      violation:
        'src/App renders a self-closing <BrowserRouter />. The platform already provides the router — remove it.',
    };
  }

  if (!BROWSER_ROUTER_OPEN_RE.test(source)) {
    return { content: source, changed: false, violation: null };
  }

  const content = source
    .replace(/<BrowserRouter\b[^>]*>/g, '<>')
    .replace(/<\/BrowserRouter>/g, '</>')
    .replace(
      /import\s*\{([^}]*)\}\s*from\s*(['"])react-router-dom\2;?/g,
      (full, specifiers: string, quote: string) => {
        const kept = specifiers
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part.length > 0 && !/^BrowserRouter(\s+as\s+\w+)?$/.test(part));
        return kept.length
          ? `import { ${kept.join(', ')} } from ${quote}react-router-dom${quote};`
          : '';
      },
    );

  return { content, changed: true, violation: null };
}
