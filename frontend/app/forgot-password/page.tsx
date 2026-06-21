'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Video, Mail, MailCheck } from 'lucide-react';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.forgotPassword(email);
      setSent(true);
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
          {sent ? (
            <div className="flex flex-col items-center text-center gap-2">
              <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center mb-1">
                <MailCheck className="w-7 h-7 text-blue-400" />
              </div>
              <h1 className="text-xl font-bold">Check your inbox</h1>
              <p className="text-sm text-slate-400">
                If an account exists for <b>{email}</b>, we&apos;ve sent a link to
                reset your password. The link is valid for 1 hour.
              </p>
              <Link
                href="/login"
                className="mt-3 text-sm text-blue-400 hover:text-blue-300"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-bold">Forgot password?</h1>
              <p className="text-sm text-slate-400 mt-1">
                Enter your email and we&apos;ll send you a reset link.
              </p>
              <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
                <div className="relative">
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
                <button
                  type="submit"
                  disabled={loading}
                  className="py-2.5 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium text-sm disabled:opacity-50"
                >
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
              <Link
                href="/login"
                className="mt-6 block text-center text-sm text-slate-400 hover:text-slate-200"
              >
                Back to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
