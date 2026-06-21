'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Video,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Users,
  MonitorUp,
  ShieldCheck,
  MessageSquare,
} from 'lucide-react';
import { api } from '@/lib/api';
import { APP_NAME } from '@/lib/config';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  async function resendVerification() {
    try {
      await api.resendVerification(email);
      setResent(true);
    } catch {
      /* ignore */
    }
  }

  function finishLogin(token: string, user: any) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    router.replace('/dashboard');
  }

  // Render the "Sign in with Google" button once the GIS script is ready.
  useEffect(() => {
    if (checking || !GOOGLE_CLIENT_ID) return;

    function init() {
      const g = (window as any).google;
      if (!g?.accounts?.id || !googleBtnRef.current) return;
      g.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (resp: any) => {
          try {
            const { token, user } = await api.googleLogin(resp.credential);
            finishLogin(token, user);
          } catch (err: any) {
            setError(err.message || 'Google sign-in failed');
          }
        },
      });
      g.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'filled_blue',
        size: 'large',
        text: 'continue_with',
        width: 320,
      });
    }

    if ((window as any).google?.accounts?.id) {
      init();
      return;
    }
    let s = document.getElementById('gis-script') as HTMLScriptElement | null;
    if (!s) {
      s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.defer = true;
      s.id = 'gis-script';
      document.body.appendChild(s);
    }
    s.addEventListener('load', init);
    return () => s?.removeEventListener('load', init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking]);

  // Already logged in (valid saved session)? Go straight to the dashboard.
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setChecking(false);
      return;
    }
    api
      .me()
      .then(() => router.replace('/dashboard'))
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setChecking(false);
      });
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setUnverified(false);
    setResent(false);
    setLoading(true);
    try {
      const { token, user } = await api.login({ email, password });
      finishLogin(token, user);
    } catch (err: any) {
      setError(err.message);
      if (err?.status === 403) setUnverified(true);
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <span className="w-6 h-6 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="min-h-screen flex bg-slate-950 text-slate-100">
      {/* Left: branding / showcase (desktop only) */}
      <section className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-indigo-700 to-slate-900" />
        {/* soft decorative blobs */}
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-blue-400/20 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-indigo-400/20 rounded-full blur-3xl" />

        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
              <Video className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">{APP_NAME}</span>
          </div>

          <div className="max-w-md">
            <h2 className="text-3xl xl:text-4xl font-bold leading-tight">
              Meet, talk, and collaborate — all in your browser.
            </h2>
            <p className="mt-4 text-white/80">
              HD video rooms with screen share, virtual backgrounds, chat, and
              host controls. No installs.
            </p>

            <ul className="mt-8 space-y-4">
              <Feature icon={Users} text="Multi-party HD video & audio (SFU)" />
              <Feature icon={MonitorUp} text="Screen share & virtual backgrounds" />
              <Feature icon={MessageSquare} text="In-room chat, reactions & raise hand" />
              <Feature icon={ShieldCheck} text="Lobby, PIN, and host moderation" />
            </ul>
          </div>

          <p className="text-xs text-white/50">
            © {new Date().getFullYear()} {APP_NAME}
          </p>
        </div>
      </section>

      {/* Right: login form */}
      <section className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {/* mobile logo */}
          <div className="lg:hidden flex items-center justify-center gap-2 mb-8">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
              <Video className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold">{APP_NAME}</span>
          </div>

          <h1 className="text-2xl font-bold">Welcome back</h1>
          <p className="text-slate-400 text-sm mt-1">
            Sign in to start or join a meeting.
          </p>

          <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4">
            {error && (
              <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {error}
                {unverified && (
                  <button
                    type="button"
                    onClick={resendVerification}
                    disabled={resent}
                    className="block mt-1 text-blue-300 hover:text-blue-200 underline disabled:opacity-60"
                  >
                    {resent ? 'Verification email sent' : 'Resend verification email'}
                  </button>
                )}
              </div>
            )}

            <label className="block">
              <span className="text-xs font-medium text-slate-400">Email</span>
              <div className="mt-1 relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  required
                />
              </div>
            </label>

            <label className="block">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">Password</span>
                <Link
                  href="/forgot-password"
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="mt-1 relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </label>

            <button
              type="submit"
              disabled={loading}
              className="mt-1 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && (
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              )}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>

            {GOOGLE_CLIENT_ID && (
              <>
                <div className="flex items-center gap-3 text-xs text-slate-500 my-1">
                  <span className="flex-1 h-px bg-slate-700" />
                  or continue with
                  <span className="flex-1 h-px bg-slate-700" />
                </div>
                <div ref={googleBtnRef} className="flex justify-center" />
              </>
            )}
          </form>

          <p className="mt-6 text-sm text-slate-400 text-center">
            Don&apos;t have an account?{' '}
            <Link href="/register" className="text-blue-400 hover:text-blue-300 font-medium">
              Create one
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

function Feature({
  icon: Icon,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}) {
  return (
    <li className="flex items-center gap-3">
      <span className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-white" />
      </span>
      <span className="text-white/90 text-sm">{text}</span>
    </li>
  );
}
