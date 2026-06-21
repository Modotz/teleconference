'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Video, Lock, Eye, EyeOff, CircleCheck, CircleX } from 'lucide-react';
import { api } from '@/lib/api';

export default function ResetPasswordPage() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token') || '');
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err: any) {
      setError(err.message || 'Reset failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
            <Video className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-bold">Teleconference</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8">
          {done ? (
            <div className="flex flex-col items-center text-center gap-2">
              <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center mb-1">
                <CircleCheck className="w-7 h-7 text-green-400" />
              </div>
              <h1 className="text-xl font-bold">Password updated</h1>
              <p className="text-sm text-slate-400">
                You can now sign in with your new password.
              </p>
              <Link
                href="/login"
                className="mt-2 inline-block px-5 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium"
              >
                Go to sign in
              </Link>
            </div>
          ) : !token ? (
            <div className="flex flex-col items-center text-center gap-2">
              <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center mb-1">
                <CircleX className="w-7 h-7 text-red-400" />
              </div>
              <h1 className="text-xl font-bold">Invalid link</h1>
              <p className="text-sm text-slate-400">
                This reset link is missing or malformed.
              </p>
              <Link
                href="/forgot-password"
                className="mt-2 text-sm text-blue-400 hover:text-blue-300"
              >
                Request a new link
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-bold">Set a new password</h1>
              <p className="text-sm text-slate-400 mt-1">
                Choose a strong password you don&apos;t use elsewhere.
              </p>
              <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
                {error && (
                  <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                    {error}
                  </div>
                )}
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type={show ? 'text' : 'password'}
                    placeholder="New password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-10 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    aria-label={show ? 'Hide password' : 'Show password'}
                  >
                    {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type={show ? 'text' : 'password'}
                    placeholder="Confirm new password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="w-full pl-10 pr-3 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="py-2.5 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium text-sm disabled:opacity-50"
                >
                  {loading ? 'Updating…' : 'Update password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
