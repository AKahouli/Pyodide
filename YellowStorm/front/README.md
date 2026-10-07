# YellowStorm Frontend

A React-based frontend application built with Vite, TypeScript, and Tailwind CSS.

## Environment Variables

### Required

_None_ - The frontend can run with default configuration.

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API base URL | `http://localhost:3000/api/v1` |
| `VITE_SOCKET_BASE_URL` | Socket.IO origin override (dev, build-arg, or container env via `/config.js`) | (derived from API URL) |

For POC Docker, set on the front container (written to `/config.js` at start):

```env
VITE_API_URL=https://poc.back.yellowmind.ai/api/v1
VITE_SOCKET_BASE_URL=https://poc.back.yellowmind.ai
```

## Configuration

### Development

Create a `.env.local` file in the `front` directory:

```env
VITE_API_URL=http://localhost:3000/api/v1
```

Or set the environment variable directly:

```bash
# Windows PowerShell
$env:VITE_API_URL="http://localhost:3000/api/v1"; npm run dev

# Linux/macOS
VITE_API_URL=http://localhost:3000/api/v1 npm run dev
```

### Production

Create a `.env.production` file:

```env
VITE_API_URL=https://api.yourdomain.com/api/v1
```

Then build the application:

```bash
npm run build
```

## Azure Blob Storage Configuration

The frontend supports direct file uploads to Azure Blob Storage. For this to work, you must configure CORS on your Azure Storage account to allow requests from your frontend's origin.

### Required CORS Settings

In the Azure Portal:

1. Navigate to your **Storage Account**
2. Go to **Settings** > **Resource sharing (CORS)**
3. Under the **Blob service** tab, add a CORS rule:

| Setting | Value |
|---------|-------|
| Allowed origins | Your frontend URL (e.g., `https://app.yourdomain.com`) |
| Allowed methods | `GET`, `PUT`, `DELETE`, `HEAD`, `OPTIONS` |
| Allowed headers | `*` |
| Exposed headers | `*` |
| Max age | `3600` |

### Example CORS Configuration

For development:
- **Allowed origins**: `http://localhost:5173`

For production:
- **Allowed origins**: `https://app.yourdomain.com`

> **Note**: Without proper CORS configuration, direct uploads from the browser will fail with CORS errors.

## Scripts

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run preview  # Preview production build
npm run lint     # Run ESLint
```

## Localization

- All user-facing copy lives in JSON namespaces under `src/modules/*/locales`. Files are flat (one level of nesting max) to keep keys predictable.
- Keep keys flat even for deeply nested concepts: prefer dot notation like `roles.permissions.groups.users.label` instead of `{ "roles": { "permissions": { ... }}}`.
- Shared strings (`save`, `cancel`, etc.) sit in `src/modules/localization/locales/{lang}/common.json`. Error code messages use the dedicated `errors.json` namespace and are loaded automatically by `getErrorMessage`.
- When adding a new module or UI surface, create matching entries for each supported language (`en`, `fr`) and reference them via `useModuleTranslation('<namespace>')`.
- Admin configuration (sidebar/menu entries, permission labels, etc.) must define `labelKey`/`descriptionKey` in `constants.ts` and supply the translated text in `src/modules/admin/locales/{lang}.json`.
