'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Video, MailCheck, CircleCheck, CircleX, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { APP_NAME } from '@/lib/config';

type Status = 'verifying' | 'success' | 'error' | 'info';

export default function VerifyEmailPage() {
  const [status, setStatus] = useState<Status>('info');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [resent, setResent] = useState(false);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    setEmail(params.get('email') || '');
    if (token) {
      setStatus('verifying');
      api
        .verifyEmail(token)
        .then(() => setStatus('success'))
        .catch((e: any) => {
          setError(e.message || 'Verification failed');
          setStatus('error');
        });
    } else {
      setStatus('info');
    }
  }, []);

  async function resend() {
    if (!email) return;
    setResending(true);
    try {
      await api.resendVerification(email);
      setResent(true);
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthShell>
      {status === 'verifying' && (
        <Centered
          icon={<Loader2 className="w-7 h-7 text-blue-400 animate-spin" />}
          title="Verifying your email…"
          desc="Hang tight for a moment."
        />
      )}

      {status === 'success' && (
        <Centered
          icon={<CircleCheck className="w-7 h-7 text-green-400" />}
          title="Email verified!"
          desc="Your account is active. You can sign in now."
        >
          <Link
            href="/login"
            className="mt-2 inline-block px-5 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium"
          >
            Go to sign in
          </Link>
        </Centered>
      )}

      {status === 'error' && (
        <Centered
          icon={<CircleX className="w-7 h-7 text-red-400" />}
          title="Verification failed"
          desc={error || 'This link is invalid or has expired.'}
        >
          {email && (
            <button
              onClick={resend}
              disabled={resending || resent}
              className="mt-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm disabled:opacity-50"
            >
              {resent ? 'Email sent' : resending ? 'Sending…' : 'Resend verification email'}
            </button>
          )}
          <Link href="/login" className="mt-3 text-sm text-blue-400 hover:text-blue-300">
            Back to sign in
          </Link>
        </Centered>
      )}

      {status === 'info' && (
        <Centered
          icon={<MailCheck className="w-7 h-7 text-blue-400" />}
          title="Check your inbox"
          desc={
            email
              ? `We sent a verification link to ${email}. Click it to activate your account.`
              : 'We sent you a verification link. Click it to activate your account.'
          }
        >
          {email && (
            <button
              onClick={resend}
              disabled={resending || resent}
              className="mt-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm disabled:opacity-50"
            >
              {resent ? 'Email sent' : resending ? 'Sending…' : "Didn't get it? Resend"}
            </button>
          )}
          <Link href="/login" className="mt-3 text-sm text-blue-400 hover:text-blue-300">
            Back to sign in
          </Link>
        </Centered>
      )}
    </AuthShell>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
            <Video className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-bold">{APP_NAME}</span>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8">
          {children}
        </div>
      </div>
    </main>
  );
}

function Centered({
  icon,
  title,
  desc,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-2">
      <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center mb-1">
        {icon}
      </div>
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="text-sm text-slate-400">{desc}</p>
      {children}
    </div>
  );
}
