import { useAuth } from '@/lib/yellowmind-auth';

/**
 * Business root. The platform router already mounts this inside the
 * authenticated route — build the product here.
 */
export default function App() {
  const { user, logout } = useAuth();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Your app is ready</h1>
      <p className="text-muted-foreground">
        Signed in as {user?.email ?? 'preview user'}. Replace this screen with your product.
      </p>
      <button
        type="button"
        onClick={logout}
        className="w-fit rounded-md border px-4 py-2 text-sm font-medium"
      >
        Sign out
      </button>
    </main>
  );
}
