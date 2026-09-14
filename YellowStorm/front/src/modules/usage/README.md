# Usage Module (Frontend)

The usage module provides usage tracking, plan management, and upgrade flows for the application, enabling users to monitor their token and request consumption.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Directory Structure](#directory-structure)
- [Types](#types)
- [API Layer](#api-layer)
- [Usage Context](#usage-context)
- [Components](#components)
- [Testing](#testing)
- [Usage Examples](#usage-examples)

---

## Overview

The usage module provides:

- **Usage Tracking**: Monitor token and request consumption across billing periods
- **Plan Management**: Display current plan details and feature limits
- **Auto-Refresh**: Automatic status refresh every 5 minutes
- **Upgrade Flows**: Plan comparison and upgrade UI
- **Limit Warnings**: Banners and modals when approaching or exceeding limits

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          USAGE MODULE (Frontend)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         REACT COMPONENTS                              │   │
│  │                                                                       │   │
│  │   UsageSection        UsageLimitBanner        UpgradePage            │   │
│  │   (Settings Modal)    (Inline Warning)        (Plan Cards)           │   │
│  │        │                    │                      │                  │   │
│  │        └────────────────────┼──────────────────────┘                  │   │
│  │                             │                                         │   │
│  │                             ▼                                         │   │
│  │  ┌────────────────────────────────────────────────────────────────┐  │   │
│  │  │                      USAGE CONTEXT                              │  │   │
│  │  │                                                                 │  │   │
│  │  │  useUsage()                                                     │  │   │
│  │  │  ├─ status: UsageStatus | null                                  │  │   │
│  │  │  ├─ currentPlan: Plan | null                                    │  │   │
│  │  │  ├─ plans: Plan[]                                               │  │   │
│  │  │  ├─ isLoading: boolean                                          │  │   │
│  │  │  └─ refresh(): Promise<void>                                    │  │   │
│  │  └────────────────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                          API LAYER                                    │   │
│  │                                                                       │   │
│  │  getUsageStatus()   getCurrentPlan()   getPlans()   getUsageHistory() │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                     BACKEND APIs (/api/v1/usage)                      │   │
│  │                                                                       │   │
│  │  GET /usage/status          ─ Current usage status                   │   │
│  │  GET /usage/plan            ─ Current plan details                   │   │
│  │  GET /usage/plans           ─ Available plans list                   │   │
│  │  GET /usage/history         ─ Usage history over time                │   │
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
| **Lucide React** | Icons (Zap, Infinity, Check, Crown) |
| **Radix UI** | Accessible UI primitives (Progress) |
| **React Router** | Navigation to upgrade page |

---

## Directory Structure

```
usage/
├── index.ts              # Public exports
├── index.test.ts         # Module export tests
├── types.ts              # TypeScript interfaces and constants
├── types.test.ts         # Types utility tests
├── api.ts                # API functions
├── api.test.ts           # API tests
├── UsageContext.tsx      # React Context with auto-refresh
├── UsageContext.test.tsx # Context tests
├── test-utils.ts         # Shared usage test builders
├── components/
│   ├── UsageSection.tsx  # Settings modal section
│   ├── UsageSection.test.tsx
│   ├── UsageLimitBanner.tsx  # Inline limit warning
│   ├── UsageLimitBanner.test.tsx
│   ├── PlanCard.tsx
│   ├── PlanCard.test.tsx
│   ├── UpgradeHeader.tsx
│   ├── UpgradeHeader.test.tsx
│   ├── UpgradePage.tsx   # Plan comparison page
│   └── UpgradePage.test.tsx
└── README.md             # This documentation
```

---

## Types

### Plan

Represents a subscription plan:

```typescript
interface Plan {
  id: string;
  name: string;                    // "Free", "Pro", "Enterprise"
  description: string;
  price: number;                   // Monthly price in cents
  billingPeriod: 'monthly' | 'yearly';
  features: PlanFeatures;
  limits: PlanLimits;
  isActive: boolean;
  isCurrent?: boolean;             // True if user's current plan
}

interface PlanFeatures {
  maxWorkspaces: number;
  maxDocumentsPerWorkspace: number;
  maxStoragePerWorkspace: number;  // In bytes
  prioritySupport: boolean;
  customBranding: boolean;
  apiAccess: boolean;
  advancedAnalytics: boolean;
}

interface PlanLimits {
  tokensPerDay: number;            // -1 for unlimited
  requestsPerMinute: number;       // -1 for unlimited
}
```

### UsageStatus

Current usage status for the billing period:

```typescript
interface UsageStatus {
  tokens: TokenUsage;
  requests: RequestUsage;
  currentWindow: UsageWindow;
  isLimitExceeded: boolean;
  planName: string;
}

interface TokenUsage {
  used: number;
  limit: number;                   // -1 for unlimited
  percentage: number;              // 0-100
}

interface RequestUsage {
  used: number;
  limit: number;                   // -1 for unlimited
  percentage: number;              // 0-100
}

interface UsageWindow {
  start: string;                   // ISO date
  end: string;                     // ISO date
  type: 'daily' | 'monthly';
}
```

### Display Constants

```typescript
// Human-readable feature names
const FEATURE_DISPLAY_NAMES: Record<string, string> = {
  maxWorkspaces: 'Workspaces',
  maxDocumentsPerWorkspace: 'Documents per Workspace',
  maxStoragePerWorkspace: 'Storage per Workspace',
  prioritySupport: 'Priority Support',
  customBranding: 'Custom Branding',
  apiAccess: 'API Access',
  advancedAnalytics: 'Advanced Analytics',
  tokensPerDay: 'Daily Tokens',
  requestsPerMinute: 'Requests per Minute',
};

// Plan card colors
const PLAN_COLORS: Record<string, string> = {
  free: 'border-gray-200',
  pro: 'border-blue-500',
  enterprise: 'border-purple-500',
};
```

---

## API Layer

### Functions

| Function | Method | Endpoint | Description |
|----------|--------|----------|-------------|
| `getUsageStatus()` | GET | `/usage/status` | Get current usage metrics |
| `getCurrentPlan()` | GET | `/usage/plan` | Get user's current plan |
| `getPlans()` | GET | `/usage/plans` | List all available plans |
| `getUsageHistory(params)` | GET | `/usage/history` | Get usage history |

### API Examples

```typescript
import * as usageApi from '@/modules/usage/api';

// Get current usage status
const status = await usageApi.getUsageStatus();
console.log(`Tokens used: ${status.tokens.used}/${status.tokens.limit}`);

// Get current plan
const plan = await usageApi.getCurrentPlan();
console.log(`Current plan: ${plan.name}`);

// Get all available plans
const plans = await usageApi.getPlans();

// Get usage history
const history = await usageApi.getUsageHistory({
  startDate: '2024-01-01',
  endDate: '2024-01-31',
  granularity: 'daily',
});
```

---

## Usage Context

### UsageProvider

Provides usage data to the entire application with automatic refresh:

```tsx
import { UsageProvider } from '@/modules/usage';

function App() {
  return (
    <UsageProvider>
      <YourApp />
    </UsageProvider>
  );
}
```

### useUsage Hook

```typescript
const {
  status,        // UsageStatus | null - Current usage metrics
  currentPlan,   // Plan | null - User's current plan
  plans,         // Plan[] - All available plans
  isLoading,     // boolean - Loading state
  refresh,       // () => Promise<void> - Manual refresh
} = useUsage();
```

### Auto-Refresh Behavior

The context automatically refreshes usage data every 5 minutes:

```
┌─────────────────────────────────────────────────────────────────┐
│                    AUTO-REFRESH FLOW                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Component mounts                                                │
│         │                                                        │
│         ▼                                                        │
│  Initial fetch (status, currentPlan, plans)                     │
│         │                                                        │
│         ▼                                                        │
│  Set interval (5 minutes)                                        │
│         │                                                        │
│         ├──────────────────────────────────────────┐             │
│         │                                          │             │
│         ▼                                          │             │
│  Wait 5 minutes ─────► Refresh status ─────────────┘             │
│                                                                  │
│  Component unmounts → Clear interval                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Context Implementation

```typescript
interface UsageContextType {
  status: UsageStatus | null;
  currentPlan: Plan | null;
  plans: Plan[];
  isLoading: boolean;
  refresh: () => Promise<void>;
}

// Auto-refresh interval: 5 minutes
const REFRESH_INTERVAL = 5 * 60 * 1000;
```

---

## Components

### UsageSection

Displays usage statistics in the settings modal with progress bars.

**Features:**
- Current plan name with upgrade button
- Token usage progress bar (daily)
- Request usage progress bar (per minute)
- Billing period dates
- Handles unlimited limits (-1)

**Visual Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│ Usage                                                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Current Plan                                                     │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ [⚡] Pro Plan                              [Upgrade]        │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ Token Usage (Daily)                                              │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ████████████████░░░░░░░░░░░░░░░░░░░░░░░░  45%              │ │
│ │ 45,000 / 100,000 tokens                                     │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ Request Usage (Per Minute)                                       │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  25%              │ │
│ │ 15 / 60 requests                                            │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ Current Period: Jan 1 - Jan 31, 2024                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Usage:**
```tsx
import { UsageSection } from '@/modules/usage';

// In SettingsModal
case 'usage':
  return <UsageSection />;
```

---

### UsageLimitBanner

Inline banner displayed when user exceeds their usage limits.

**Features:**
- Dismissible with X button
- Shows upgrade call-to-action
- Links to upgrade page
- Compact inline design

**Visual Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│ ⚠️ You've reached your daily limit. Upgrade for more tokens. [→]│
└─────────────────────────────────────────────────────────────────┘
```

**Props:**
```typescript
interface UsageLimitBannerProps {
  onDismiss?: () => void;
}
```

**Usage:**
```tsx
import { UsageLimitBanner } from '@/modules/usage';

function ChatInterface() {
  const { status } = useUsage();
  const [dismissed, setDismissed] = useState(false);

  if (status?.isLimitExceeded && !dismissed) {
    return <UsageLimitBanner onDismiss={() => setDismissed(true)} />;
  }

  return <ChatInput />;
}
```

---

### UpgradePage

Full-page plan comparison and upgrade interface.

**Features:**
- Plan comparison cards
- Feature checkmarks
- Current plan indicator
- Price display (monthly/yearly)
- Upgrade buttons
- Crown icon for premium plans

**Visual Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│                     Choose Your Plan                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │    FREE     │  │     PRO     │  │ ENTERPRISE  │              │
│  │             │  │   ★ ★ ★     │  │   ★ ★ ★ ★   │              │
│  │    $0/mo    │  │   $29/mo    │  │   $99/mo    │              │
│  │             │  │             │  │             │              │
│  │ ✓ 3 spaces  │  │ ✓ 10 spaces │  │ ✓ Unlimited │              │
│  │ ✓ 10K tokens│  │ ✓ 100K tkns │  │ ✓ Unlimited │              │
│  │ ✗ API       │  │ ✓ API       │  │ ✓ API       │              │
│  │ ✗ Support   │  │ ✓ Support   │  │ ✓ Priority  │              │
│  │             │  │             │  │             │              │
│  │ [Current]   │  │ [Upgrade]   │  │ [Upgrade]   │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Route:**
```tsx
// In router configuration
<Route path="/upgrade" element={<UpgradePage />} />
```

---

## Testing

- Usage tests are colocated as `*.test.ts` and `*.test.tsx`.
- Coverage includes:
  - API layer (`api.ts`)
  - context lifecycle and refresh behavior (`UsageContext.tsx`)
  - UI behavior for `UsageSection`, `UsageLimitBanner`, `PlanCard`, `UpgradeHeader`, and `UpgradePage`
  - module/type exports and utility formatting (`formatStorageSize`)

Run usage tests from `front/`:

```bash
npm test -- src/modules/usage
```

Check test duplication threshold (<3%):

```bash
npx jscpd src/modules/usage --pattern "**/*.test.{ts,tsx}" --threshold 3 --reporters console
```

---

## Usage Examples

### Basic Usage Tracking

```tsx
import { useUsage } from '@/modules/usage';

function UsageDisplay() {
  const { status, isLoading } = useUsage();

  if (isLoading || !status) {
    return <div>Loading usage...</div>;
  }

  return (
    <div>
      <p>Tokens: {status.tokens.used} / {status.tokens.limit}</p>
      <p>Requests: {status.requests.used} / {status.requests.limit}</p>
    </div>
  );
}
```

### Limit Check Before Action

```tsx
import { useUsage } from '@/modules/usage';

function SendMessageButton({ onSend }: { onSend: () => void }) {
  const { status } = useUsage();

  const handleClick = () => {
    if (status?.isLimitExceeded) {
      toast.error('Usage limit exceeded. Please upgrade your plan.');
      return;
    }
    onSend();
  };

  return (
    <button onClick={handleClick} disabled={status?.isLimitExceeded}>
      Send Message
    </button>
  );
}
```

### Plan Feature Check

```tsx
import { useUsage } from '@/modules/usage';

function WorkspaceCreator() {
  const { currentPlan } = useUsage();

  const canCreateWorkspace = () => {
    if (!currentPlan) return false;
    // Check if user has workspace slots available
    return currentPlan.features.maxWorkspaces > 0;
  };

  return (
    <button disabled={!canCreateWorkspace()}>
      Create Workspace
    </button>
  );
}
```

### Manual Refresh

```tsx
import { useUsage } from '@/modules/usage';

function RefreshUsageButton() {
  const { refresh, isLoading } = useUsage();

  return (
    <button onClick={refresh} disabled={isLoading}>
      {isLoading ? 'Refreshing...' : 'Refresh Usage'}
    </button>
  );
}
```

### Format Unlimited Values

```tsx
function formatLimit(limit: number): string {
  if (limit === -1) return '∞';
  return limit.toLocaleString();
}

function TokenDisplay({ tokens }: { tokens: TokenUsage }) {
  return (
    <span>
      {tokens.used.toLocaleString()} / {formatLimit(tokens.limit)}
    </span>
  );
}
```

### Conditional Upgrade Prompt

```tsx
import { useUsage } from '@/modules/usage';
import { useNavigate } from 'react-router-dom';

function UpgradePrompt() {
  const { status, currentPlan } = useUsage();
  const navigate = useNavigate();

  // Show upgrade prompt when usage is over 80%
  const shouldShowPrompt = status && (
    status.tokens.percentage > 80 ||
    status.requests.percentage > 80
  );

  if (!shouldShowPrompt || currentPlan?.name === 'Enterprise') {
    return null;
  }

  return (
    <div className="bg-yellow-50 p-4 rounded">
      <p>You're approaching your usage limit.</p>
      <button onClick={() => navigate('/upgrade')}>
        Upgrade Now
      </button>
    </div>
  );
}
```

---

## Integration

### With Settings Modal

The UsageSection is rendered as a tab in the settings modal:

```tsx
import { UsageSection } from '@/modules/usage';

function SettingsModal() {
  const { activeSection } = useSettingsModal();

  return (
    <div>
      {activeSection === 'usage' && <UsageSection />}
    </div>
  );
}
```

### With Conversation Module

Check limits before sending messages:

```tsx
import { useUsage } from '@/modules/usage';

function ConversationInput() {
  const { status, refresh } = useUsage();

  const handleSend = async (content: string) => {
    if (status?.isLimitExceeded) {
      toast.error('Daily limit exceeded');
      return;
    }

    await sendMessage(content);

    // Refresh usage after sending
    await refresh();
  };
}
```

### With Auth Module

Load usage data after authentication:

```tsx
import { useAuth } from '@/modules/auth';
import { useUsage } from '@/modules/usage';

function AppContent() {
  const { isAuthenticated } = useAuth();
  const { refresh } = useUsage();

  useEffect(() => {
    if (isAuthenticated) {
      refresh();
    }
  }, [isAuthenticated, refresh]);
}
```
