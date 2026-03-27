# Profile Module (Frontend)

The profile module provides a comprehensive settings interface for users to manage their profile, sessions, appearance preferences, data controls, and view system health status.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Directory Structure](#directory-structure)
- [Types](#types)
- [API Layer](#api-layer)
- [Settings Context](#settings-context)
- [Components](#components)
- [Sections](#sections)
- [Usage Examples](#usage-examples)

---

## Overview

The profile module provides:

- **Settings Modal**: Full-featured settings interface with sidebar navigation
- **Profile Management**: Edit user information (name, company)
- **Session Management**: View and revoke active sessions across devices
- **Appearance Settings**: Theme selection (light, dark, system)
- **Data Controls**: Privacy settings, data export, account deletion
- **System Health**: Real-time backend health monitoring with charts
- **Usage Statistics**: Integration with usage module for plan/quota display

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PROFILE MODULE (Frontend)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                      SETTINGS MODAL CONTEXT                           │   │
│  │                                                                       │   │
│  │   useSettingsModal()                                                  │   │
│  │   ├─ isOpen: boolean                                                  │   │
│  │   ├─ activeSection: SettingsSection                                   │   │
│  │   ├─ openSettings(section?)                                           │   │
│  │   ├─ closeSettings()                                                  │   │
│  │   └─ setActiveSection(section)                                        │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        SETTINGS MODAL                                 │   │
│  │  ┌─────────────┐    ┌────────────────────────────────────────────┐   │   │
│  │  │   Sidebar   │    │              Content Area                   │   │   │
│  │  │             │    │                                             │   │   │
│  │  │  ○ Profile  │───►│  ┌──────────────────────────────────────┐  │   │   │
│  │  │  ○ Sessions │    │  │       Active Section Component       │  │   │   │
│  │  │  ○ Appearance│   │  │                                      │  │   │   │
│  │  │  ○ Data     │    │  │  - ProfileSection                    │  │   │   │
│  │  │  ○ Usage    │    │  │  - SessionsSection                   │  │   │   │
│  │  │  ○ Health   │    │  │  - AppearanceSection                 │  │   │   │
│  │  │             │    │  │  - DataControlsSection               │  │   │   │
│  │  └─────────────┘    │  │  - UsageSection                      │  │   │   │
│  │                     │  │  - HealthSection                     │  │   │   │
│  │                     │  └──────────────────────────────────────┘  │   │   │
│  │                     └────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                          API LAYER                                    │   │
│  │                                                                       │   │
│  │  Profile:    updateProfile()                                         │   │
│  │  Sessions:   getSessions(), revokeSession()                          │   │
│  │  Data:       updateDataSharing(), exportData(), deleteAccount()      │   │
│  │  Health:     getHealthStatus(), getHealthHistory(), getHealthStats() │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         BACKEND APIs                                  │   │
│  │                                                                       │   │
│  │  PUT    /users/me                    ─ Update profile                │   │
│  │  GET    /auth/sessions               ─ List sessions                 │   │
│  │  DELETE /auth/sessions/:id           ─ Revoke session                │   │
│  │  GET    /users/me/export             ─ Export data                   │   │
│  │  DELETE /users/me                    ─ Delete account                │   │
│  │  GET    /health                      ─ Health status                 │   │
│  │  GET    /health/history              ─ Health history                │   │
│  │  GET    /health/stats                ─ Health statistics             │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **React 18** | UI framework with Context API |
| **TypeScript** | Type-safe development |
| **React Hook Form** | Form state management |
| **Zod** | Schema validation |
| **Recharts** | Health monitoring charts |
| **date-fns** | Date formatting |
| **Lucide React** | Icons |
| **Radix UI** | Accessible UI primitives (Dialog, Switch, etc.) |
| **Sonner** | Toast notifications |

---

## Directory Structure

```
profile/
├── index.ts                          # Public exports
├── types.ts                          # TypeScript interfaces
├── api.ts                            # API functions
├── SettingsContext.tsx               # Modal open/close context
├── components/
│   ├── index.ts                      # Component exports
│   ├── SettingsModal.tsx             # Main modal with sidebar
│   ├── ProfileSection.tsx            # Profile editing form
│   ├── SessionsSection.tsx           # Session management
│   ├── AppearanceSection.tsx         # Theme selection
│   ├── DataControlsSection.tsx       # Privacy & data management
│   └── HealthSection.tsx             # System health dashboard
└── README.md                         # This documentation
```

---

## Types

### Settings Section Types

```typescript
// Available sections in the settings modal
type SettingsSection =
  | 'profile'
  | 'sessions'
  | 'appearance'
  | 'data-controls'
  | 'usage'
  | 'health';

// Theme options
type ThemeMode = 'light' | 'dark' | 'system';
```

### Session Interface

```typescript
interface Session {
  id: string;
  deviceInfo: {
    browser?: string;
    os?: string;
    device?: string;
  };
  ipAddress: string;
  lastActivityAt: string;
  createdAt: string;
  isCurrent: boolean;
}
```

### Profile Data

```typescript
interface UpdateProfileData {
  firstName?: string;
  lastName?: string;
  company?: string;
}

interface AppearanceSettings {
  theme: ThemeMode;
}

interface DataControlsSettings {
  dataSharing: boolean;
}
```

### Health Types

```typescript
interface HealthCheckDetail {
  status: 'up' | 'down' | 'degraded';
  responseTime?: number;
  message?: string;
  lastChecked: string;
}

interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version: string;
  uptime: number;
  checks: Record<string, HealthCheckDetail>;
}

interface HealthHistoryStats {
  totalRecords: number;
  uptimePercentage: number;
  avgResponseTimes: Record<string, number>;
  statusBreakdown: {
    healthy: number;
    unhealthy: number;
    degraded: number;
  };
  period: {
    from: string;
    to: string;
    minutes: number;
  };
}
```

### Context Type

```typescript
interface SettingsModalContextType {
  isOpen: boolean;
  activeSection: SettingsSection;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  setActiveSection: (section: SettingsSection) => void;
}
```

---

## API Layer

### Functions

| Function | Method | Endpoint | Description |
|----------|--------|----------|-------------|
| `updateProfile(data)` | PUT | `/users/me` | Update user profile |
| `getSessions()` | GET | `/auth/sessions` | List active sessions |
| `revokeSession(id)` | DELETE | `/auth/sessions/:id` | Revoke a session |
| `updateDataSharing(enabled)` | PUT | `/users/me` | Toggle data sharing |
| `exportData()` | GET | `/users/me/export` | Export user data as JSON |
| `deleteAccount()` | DELETE | `/users/me` | Permanently delete account |
| `getHealthStatus()` | GET | `/health` | Get current health status |
| `getHealthHistory(params)` | GET | `/health/history` | Get health history |
| `getHealthStats(minutes)` | GET | `/health/stats` | Get health statistics |

### API Examples

```typescript
import * as profileApi from '@/modules/profile/api';

// Update profile
await profileApi.updateProfile({
  firstName: 'John',
  lastName: 'Doe',
  company: 'Acme Inc',
});

// Get sessions
const sessions = await profileApi.getSessions();

// Revoke session
await profileApi.revokeSession('session-123');

// Export data (returns Blob)
const blob = await profileApi.exportData();

// Get health with history
const health = await profileApi.getHealthStatus();
const history = await profileApi.getHealthHistory({ minutes: 60, limit: 100 });
const stats = await profileApi.getHealthStats(60);
```

---

## Settings Context

### SettingsModalProvider

Provides modal state management to the entire application:

```tsx
import { SettingsModalProvider } from '@/modules/profile';

function App() {
  return (
    <SettingsModalProvider>
      <YourApp />
      <SettingsModal />
    </SettingsModalProvider>
  );
}
```

### useSettingsModal Hook

```typescript
const {
  isOpen,           // boolean - modal visibility
  activeSection,    // SettingsSection - current tab
  openSettings,     // (section?) => void - open modal
  closeSettings,    // () => void - close modal
  setActiveSection, // (section) => void - switch tabs
} = useSettingsModal();
```

### Opening Settings from Anywhere

```tsx
import { useSettingsModal } from '@/modules/profile';

function ProfileButton() {
  const { openSettings } = useSettingsModal();

  return (
    <button onClick={() => openSettings('profile')}>
      Edit Profile
    </button>
  );
}

function SessionsLink() {
  const { openSettings } = useSettingsModal();

  return (
    <button onClick={() => openSettings('sessions')}>
      Manage Sessions
    </button>
  );
}
```

---

## Components

### SettingsModal

Main settings interface with responsive sidebar navigation.

**Features:**
- Sidebar with icons and labels (icons only on mobile)
- Smooth section switching
- ScrollArea for content overflow
- Responsive design (95vw width, max 4xl)

**Navigation Items:**

| Section | Icon | Label |
|---------|------|-------|
| `profile` | User | Profile |
| `sessions` | Laptop | Sessions |
| `appearance` | Monitor | Appearance |
| `data-controls` | Shield | Data Controls |
| `usage` | BarChart3 | Usage |
| `health` | Activity | Health |

---

## Sections

### ProfileSection

Edit user profile information with form validation.

**Features:**
- Email display (read-only)
- First name / Last name fields (required)
- Company field (optional)
- Zod schema validation
- Auto-refresh user data on save

**Validation Schema:**
```typescript
const profileSchema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  company: z.string().max(100).optional(),
});
```

---

### SessionsSection

View and manage active sessions across devices.

**Features:**
- List all active sessions
- Device icon detection (mobile, laptop, desktop)
- Current session badge
- Revoke individual sessions
- "Sign out everywhere" action
- Last activity timestamps

**Device Detection:**
```typescript
// Mobile devices
if (device.includes('mobile') || device.includes('phone')) → Smartphone icon

// Desktop OS
if (os.includes('windows') || os.includes('mac') || os.includes('linux')) → Laptop icon

// Default
→ Monitor icon
```

---

### AppearanceSection

Theme and visual customization.

**Features:**
- Three theme options: Light, Dark, System
- Visual theme cards with icons
- Instant theme switching
- "System" follows device preference

**Theme Options:**

| Theme | Icon | Description |
|-------|------|-------------|
| Light | Sun | Light mode |
| Dark | Moon | Dark mode (recommended) |
| System | Monitor | Follow device settings |

---

### DataControlsSection

Privacy settings and data management.

**Features:**
- **Usage Analytics Toggle**: Enable/disable anonymous data sharing
- **Export Data**: Download all user data as JSON file
- **Delete Account**: Permanent account deletion with confirmation

**Danger Zone Actions:**
- Confirmation dialogs for destructive actions
- Lists consequences of account deletion
- Automatic logout after deletion

---

### HealthSection

Real-time backend health monitoring dashboard.

**Features:**
- Overall system status (healthy/degraded/unhealthy)
- Server version and uptime display
- Uptime percentage chart (last 60 minutes)
- Individual service health cards
- Response time trend charts per service
- Auto-refresh capability

**Monitored Services:**

| Service | Icon | Description |
|---------|------|-------------|
| memory | Cpu | Memory usage |
| eventLoop | Activity | Event loop latency |
| database | Database | MongoDB connection |
| storage | HardDrive | Azure Blob Storage |
| email | Mail | SMTP service |

**Status Colors:**

| Status | Color | Icon |
|--------|-------|------|
| healthy/up | Green | CheckCircle |
| degraded | Yellow | AlertTriangle |
| unhealthy/down | Red | XCircle |

---

## Usage Examples

### Basic Setup

```tsx
import {
  SettingsModalProvider,
  SettingsModal,
  useSettingsModal
} from '@/modules/profile';

// In App.tsx
function App() {
  return (
    <SettingsModalProvider>
      <Header />
      <MainContent />
      <SettingsModal /> {/* Renders the modal */}
    </SettingsModalProvider>
  );
}
```

### Opening Settings

```tsx
function UserMenu() {
  const { openSettings } = useSettingsModal();

  return (
    <DropdownMenu>
      <DropdownMenuItem onClick={() => openSettings('profile')}>
        Profile
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => openSettings('sessions')}>
        Sessions
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => openSettings('appearance')}>
        Appearance
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => openSettings('data-controls')}>
        Privacy
      </DropdownMenuItem>
    </DropdownMenu>
  );
}
```

### Programmatic Navigation

```tsx
function SettingsShortcuts() {
  const { openSettings, isOpen, activeSection } = useSettingsModal();

  // Open specific section
  const goToSessions = () => openSettings('sessions');

  // Check current state
  console.log(`Modal is ${isOpen ? 'open' : 'closed'}`);
  console.log(`Current section: ${activeSection}`);

  return (
    <div>
      <button onClick={() => openSettings()}>Open Settings</button>
      <button onClick={goToSessions}>Manage Sessions</button>
    </div>
  );
}
```

### Direct API Usage

```tsx
import * as profileApi from '@/modules/profile/api';
import { useApiAction } from '@/lib/use-api-action';

function ProfileForm() {
  const { execute, isLoading, error } = useApiAction(
    profileApi.updateProfile,
    {
      showSuccessToast: true,
      successMessage: 'Profile updated!',
    }
  );

  const handleSubmit = async (data: UpdateProfileData) => {
    await execute(data);
  };

  // ...
}
```

### Health Monitoring Widget

```tsx
import { getHealthStatus } from '@/modules/profile/api';
import { useEffect, useState } from 'react';

function HealthIndicator() {
  const [status, setStatus] = useState<'healthy' | 'degraded' | 'unhealthy'>('healthy');

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const health = await getHealthStatus();
        setStatus(health.status);
      } catch {
        setStatus('unhealthy');
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 60000); // Check every minute

    return () => clearInterval(interval);
  }, []);

  return (
    <div className={`status-dot ${status}`} />
  );
}
```

---

## Integration

### With Auth Module

The profile section uses `useAuth()` to access and refresh user data:

```tsx
import { useAuth } from '@/modules/auth';

function ProfileSection() {
  const { user, refreshUser } = useAuth();

  // After updating profile
  const onSuccess = () => refreshUser();
}
```

### With Theme Context

The appearance section integrates with the global theme context:

```tsx
import { ThemeProviderContext } from '@/contexts/ThemeContext';

function AppearanceSection() {
  const { theme, setTheme } = React.useContext(ThemeProviderContext);

  return (
    <button onClick={() => setTheme('dark')}>
      Dark Mode
    </button>
  );
}
```

### With Usage Module

The settings modal renders `UsageSection` from the usage module:

```tsx
import { UsageSection } from '@/modules/usage';

// In SettingsModal
case 'usage':
  return <UsageSection />;
```
