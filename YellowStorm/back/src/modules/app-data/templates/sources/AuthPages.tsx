import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { isAppHomePath, resolvePublicAsset } from '@/lib/app-base';
import { resolveInvite, useAuth } from '@/lib/yellowmind-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Stay in the SPA after auth — a full reload would remount AuthProvider and
 * re-validate the token before the app renders. AppUrlNormalizer restores the
 * trailing slash that React Router drops for the app index.
 */
function redirectAfterAuth(navigate: ReturnType<typeof useNavigate>, from: string) {
  navigate(isAppHomePath(from) ? '/' : from, { replace: true });
}

function useInviteToken(): string {
  const [params] = useSearchParams();
  return params.get('invite')?.trim() || '';
}

type InviteState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; email: string }
  | { status: 'error'; message: string };

function useResolvedInvite(token: string): InviteState {
  const [state, setState] = useState<InviteState>(token ? { status: 'loading' } : { status: 'idle' });

  useEffect(() => {
    if (!token) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    void resolveInvite(token)
      .then((invite) => {
        if (!cancelled) setState({ status: 'ready', email: invite.email });
      })
      .catch((err: Error & { status?: number }) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message:
            err.status === 410
              ? 'This invitation has expired or has already been used.'
              : 'This invitation is invalid.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return state;
}

const FIELD =
  'h-12 rounded-xl border-neutral-700 bg-transparent text-base text-foreground placeholder:text-neutral-500';

function YellowsysMark({ className }: { className?: string }) {
  return (
    <img
      src={resolvePublicAsset('brand/yellowsys-logo.svg')}
      alt="Yellowsys"
      className={className}
    />
  );
}

function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="auth-stars relative min-h-screen w-full overflow-hidden">
      <header className="absolute left-6 top-6 z-20">
        <a href="https://www.yellowsys.ai/fr/" className="flex items-center gap-3" target="_blank" rel="noreferrer">
          <YellowsysMark className="h-10 w-auto" />
          <span className="text-lg font-semibold tracking-tight">Yellowsys</span>
        </a>
      </header>

      <main className="relative z-10 mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 items-center gap-10 px-6 py-24 md:grid-cols-2 md:px-12 lg:px-16">
        <section className="w-full max-w-md justify-self-center md:justify-self-start">
          <h1 className="text-4xl tracking-tight">{title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">{description}</p>
          <div className="mt-8">{children}</div>
          <div className="mt-6 text-center text-sm text-muted-foreground md:text-left">{footer}</div>
        </section>

        <aside className="relative hidden md:block" aria-hidden="true">
          <div className="overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950/70 shadow-2xl shadow-black/40">
            <div className="flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-primary/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
              <span className="ml-2 text-xs text-neutral-500">App Builder · live preview</span>
            </div>
            <div className="grid grid-cols-5">
              <div className="col-span-2 space-y-3 border-r border-neutral-800 p-4">
                <div className="rounded-2xl rounded-tl-sm bg-neutral-800 px-3 py-2 text-[11px] text-neutral-300">
                  Create a recipe app with favorites and a shopping list.
                </div>
                <div className="rounded-2xl rounded-tr-sm bg-primary/15 px-3 py-2 text-[11px] text-primary">
                  Provisioning App Data, then building the interface…
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {['write', 'preview', 'finalize'].map((chip) => (
                    <span
                      key={chip}
                      className="rounded-full border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-400"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
              <div className="col-span-3 space-y-3 p-4">
                <div className="h-3 w-1/2 rounded bg-neutral-800" />
                <div className="grid grid-cols-2 gap-2">
                  <div className="h-20 rounded-xl bg-gradient-to-br from-primary/30 to-neutral-800" />
                  <div className="h-20 rounded-xl bg-gradient-to-br from-neutral-700 to-neutral-900" />
                </div>
                <div className="h-16 rounded-xl border border-neutral-800 bg-neutral-900/80 p-3">
                  <div className="h-2 w-2/3 rounded bg-neutral-700" />
                  <div className="mt-2 h-2 w-1/3 rounded bg-primary/50" />
                </div>
              </div>
            </div>
          </div>
          <p className="mt-4 text-xs text-neutral-500">
            App Builder · chat, live preview, and a generated app that survives refresh.
          </p>
        </aside>
      </main>

      <footer className="absolute bottom-0 left-0 z-20 flex flex-wrap gap-1 px-6 py-6 text-xs text-neutral-500 md:px-12">
        <span>By continuing you agree to the </span>
        <a href="https://www.yellowsys.ai/terms" target="_blank" rel="noreferrer" className="font-bold hover:underline">
          Terms
        </a>
        <span> and </span>
        <a href="https://www.yellowsys.ai/privacy" target="_blank" rel="noreferrer" className="font-bold hover:underline">
          Privacy Policy
        </a>
        <span> of Yellowsys.</span>
      </footer>
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const inviteToken = useInviteToken();
  const invite = useResolvedInvite(inviteToken);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const lockedEmail = invite.status === 'ready' ? invite.email : '';

  useEffect(() => {
    if (lockedEmail) setEmail(lockedEmail);
  }, [lockedEmail]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(lockedEmail || email, password);
      redirectAfterAuth(navigate, from);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setPending(false);
    }
  }

  const registerTo = inviteToken ? `/register?invite=${encodeURIComponent(inviteToken)}` : '/register';

  return (
    <AuthShell
      title="Welcome back"
      description="Sign in with the account you created for this application."
      footer={
        <>
          No account?{' '}
          <Link to={registerTo} state={{ from }} className="font-medium text-primary underline-offset-4 hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            className={FIELD}
            value={lockedEmail || email}
            onChange={(e) => setEmail(e.target.value)}
            readOnly={!!lockedEmail}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            className={FIELD}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {invite.status === 'error' && <p className="text-sm text-destructive">{invite.message}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="h-12 w-full rounded-full text-base font-medium" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const inviteToken = useInviteToken();
  const invite = useResolvedInvite(inviteToken);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const lockedEmail = invite.status === 'ready' ? invite.email : '';
  const loginTo = inviteToken ? `/login?invite=${encodeURIComponent(inviteToken)}` : '/login';

  useEffect(() => {
    if (lockedEmail) setEmail(lockedEmail);
  }, [lockedEmail]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await register(lockedEmail || email, password, displayName || undefined, inviteToken || undefined);
      redirectAfterAuth(navigate, from);
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === 'APP_DATA_EMAIL_TAKEN' && inviteToken) {
        setError('This email is already registered. Sign in instead.');
      } else {
        setError(err instanceof Error ? err.message : 'Registration failed');
      }
    } finally {
      setPending(false);
    }
  }

  if (invite.status === 'loading') {
    return (
      <AuthShell title="Create your account" description="Checking your invitation…" footer={null}>
        <p className="text-sm text-muted-foreground">Loading invitation…</p>
      </AuthShell>
    );
  }

  if (invite.status === 'error') {
    return (
      <AuthShell
        title="Invitation unavailable"
        description={invite.message}
        footer={
          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground">Ask the app owner to send a new invitation.</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      description={
        lockedEmail
          ? 'Register with the invited email to use this application.'
          : 'Register to use this application. Your data stays scoped to this app.'
      }
      footer={
        <>
          Already have an account?{' '}
          <Link to={loginTo} state={{ from }} className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="displayName">Name (optional)</Label>
          <Input
            id="displayName"
            placeholder="Jane Doe"
            className={FIELD}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            className={FIELD}
            value={lockedEmail || email}
            onChange={(e) => setEmail(e.target.value)}
            readOnly={!!lockedEmail}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password (min 8 characters)</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            className={FIELD}
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && (
          <p className="text-sm text-destructive">
            {error}
            {error.includes('already registered') && (
              <>
                {' '}
                <Link to={loginTo} state={{ from }} className="font-medium underline-offset-4 hover:underline">
                  Sign in
                </Link>
              </>
            )}
          </p>
        )}
        <Button type="submit" className="h-12 w-full rounded-full text-base font-medium" disabled={pending}>
          {pending ? 'Creating…' : 'Create account'}
        </Button>
      </form>
    </AuthShell>
  );
}
