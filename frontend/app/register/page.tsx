'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Video,
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  Users,
  MonitorUp,
  ShieldCheck,
  MessageSquare,
} from 'lucide-react';
import { api } from '@/lib/api';
import { APP_NAME } from '@/lib/config';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  // Already logged in? Skip straight to the dashboard.
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
    setLoading(true);
    try {
      await api.register({ email, username, password });
      // Account created — must confirm email before signing in.
      router.replace(`/verify-email?email=${encodeURIComponent(email)}`);
    } catch (err: any) {
      setError(err.message);
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
              Create your account in seconds.
            </h2>
            <p className="mt-4 text-white/80">
              Host unlimited meetings with HD video, screen sharing, chat, and
              powerful host controls — right from the browser.
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

      {/* Right: register form */}
      <section className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center justify-center gap-2 mb-8">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
              <Video className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold">{APP_NAME}</span>
          </div>

          <h1 className="text-2xl font-bold">Create account</h1>
          <p className="text-slate-400 text-sm mt-1">
            Join and start meeting in minutes.
          </p>

          <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4">
            {error && (
              <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {error}
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
              <span className="text-xs font-medium text-slate-400">Username</span>
              <div className="mt-1 relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="your name"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  required
                />
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-slate-400">Password</span>
              <div className="mt-1 relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  minLength={6}
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
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="mt-6 text-sm text-slate-400 text-center">
            Already have an account?{' '}
            <Link href="/login" className="text-blue-400 hover:text-blue-300 font-medium">
              Sign in
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
