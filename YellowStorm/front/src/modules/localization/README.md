# Localization Module

This module handles translations and language management for the application.

## Architecture

### Core Files

- **`initI18n.ts`** - Initializes i18next before React render (called in `main.tsx`)
- **`LocalizationProvider.tsx`** - React Provider that exposes localization context
- **`useModuleTranslation.ts`** - Hook to use translations in components
- **`i18nInstance.ts`** - Singleton i18next instance
- **`DynamicImportBackend.ts`** - Custom backend for loading translations via dynamic imports
- **`namespace-loaders.ts`** - Generates loaders for translation JSON files
- **`constants.ts`** - Supported languages, namespaces, etc.

### Initialization Flow

```
1. main.tsx calls await initI18n()
2. detectInitialLanguage() reads localStorage or detects browser language
3. loadInitialResources() loads only CORE_NAMESPACES for the detected language:
   - Core: common, auth, errors, conversation, sidebar (~5 namespaces)
   - These are needed for the initial render (landing page, auth, etc.)
4. i18nInstance.init() is called with resources
5. Once ready, ReactDOM.createRoot() renders the app
6. LocalizationProvider initializes with the already-ready instance
7. When a component uses useModuleTranslation('file-viewer'):
   - The namespace is lazy-loaded on demand via DynamicImportBackend
   - Other namespaces (admin, agent, models, etc.) load as needed
```

**Performance:**
- Only the user's language is loaded (not all languages)
- Only core namespaces are loaded at startup (~5 namespaces)
- Other namespaces load on demand when their component mounts
- This keeps initial load time fast even as the app grows

## Usage

### In a component

```tsx
import { useModuleTranslation } from '@/modules/localization';

function MyComponent() {
  const { t, ready } = useModuleTranslation('common');

  return <div>{t('hello')}</div>;
}
```

### Supported languages

- `en` - English (default)
- `fr` - French

### Namespaces

**Core namespaces** (loaded at startup):
- `common` - Common texts
- `auth` - Authentication
- `errors` - Error messages
- `conversation` - Conversations
- `sidebar` - Sidebar

**Lazy-loaded namespaces** (loaded on demand):
- `admin` - Administration
- `agent` - Agents
- `file-viewer` - File viewer
- `models` - Models
- `notifications` - Notifications
- `profile` - User profile
- `usage` - Usage/quotas
- `workspace` - Workspaces

## Adding translations

### Translation file structure (flat, not nested)

```json
{
  "hello": "Hello",
  "goodbye": "Goodbye",
  "resetPassword.password.label": "New Password",
  "resetPassword.password.placeholder": "Enter your new password",
  "errors.invalidCredentials": "Invalid email or password"
}
```

### In the central module

Create a JSON file in `src/modules/localization/locales/{lang}/{namespace}.json`

### In a feature module

Create a `locales/{lang}.json` file in the module folder:

```
src/modules/myModule/
├── locales/
│   ├── en.json
│   └── fr.json
```

The `namespace-loaders.ts` will auto-detect them.

## Changing language

```tsx
import { useLocalization } from '@/modules/localization';

function LanguageSelector() {
  const { changeLanguage, language } = useLocalization();

  return (
    <select value={language} onChange={(e) => changeLanguage(e.target.value)}>
      <option value="en">English</option>
      <option value="fr">Français</option>
    </select>
  );
}
```

## Bug Fixes

### Bug: Empty text on page refresh

**Problem:** Translations were loaded in a React useEffect, causing empty text on first render.

**Solution:** Moved initialization to `main.tsx` with `await initI18n()` before the first React render.

## Notes

- The module uses `useSuspense: false` to avoid React Suspense issues
- Translations are loaded via dynamic imports for code-splitting
- Language is stored in `localStorage` with key `yellowmind:locale`
- Translation keys use dot notation for namespacing (e.g. `resetPassword.password.label`)
