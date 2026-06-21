'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Video,
  Users,
  MonitorUp,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react';
import { api } from '@/lib/api';

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  // If a saved session is still valid, skip straight to the dashboard.
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

  if (checking) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <span className="w-6 h-6 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100 flex flex-col">
      {/* Background gradient + blobs */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-950 to-indigo-950" />
      <div className="absolute -top-32 -left-20 w-[28rem] h-[28rem] bg-blue-500/15 rounded-full blur-3xl" />
      <div className="absolute -bottom-32 -right-20 w-[28rem] h-[28rem] bg-indigo-500/15 rounded-full blur-3xl" />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-6 sm:px-10 py-5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
            <Video className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold tracking-tight">Teleconference</span>
        </div>
        <Link
          href="/login"
          className="text-sm text-slate-300 hover:text-white px-4 py-2 rounded-lg hover:bg-white/5"
        >
          Sign in
        </Link>
      </header>

      {/* Hero */}
      <section className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-6 py-10">
        <span className="inline-flex items-center gap-2 text-xs font-medium text-blue-300 bg-blue-500/10 border border-blue-500/30 rounded-full px-3 py-1">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
          Browser-based · No installs
        </span>

        <h1 className="mt-6 text-4xl sm:text-5xl font-bold tracking-tight max-w-3xl">
          Meet, talk, and collaborate in{' '}
          <span className="bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            HD
          </span>
        </h1>
        <p className="mt-4 text-slate-400 max-w-xl">
          Multi-party video rooms with screen share, virtual backgrounds, chat,
          reactions, and full host controls.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row gap-3 w-full max-w-sm">
          <Link
            href="/register"
            className="flex-1 text-center px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
          >
            Get started — it&apos;s free
          </Link>
          <Link
            href="/login"
            className="flex-1 text-center px-6 py-3 bg-white/5 hover:bg-white/10 border border-slate-700 rounded-lg font-medium transition-colors"
          >
            Sign in
          </Link>
        </div>

        {/* Feature chips */}
        <div className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-3xl">
          <Chip icon={Users} text="HD video & audio" />
          <Chip icon={MonitorUp} text="Screen & backgrounds" />
          <Chip icon={MessageSquare} text="Chat & reactions" />
          <Chip icon={ShieldCheck} text="Lobby & moderation" />
        </div>
      </section>

      <footer className="relative z-10 text-center text-xs text-slate-500 py-6">
        © {new Date().getFullYear()} Teleconference · Mediasoup + Next.js
      </footer>
    </main>
  );
}

function Chip({
  icon: Icon,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  text: string;
}) {
  return (
    <div className="flex items-center gap-2 bg-white/5 border border-slate-800 rounded-lg px-3 py-2.5">
      <Icon className="w-4 h-4 text-blue-400 shrink-0" />
      <span className="text-xs sm:text-sm text-slate-300">{text}</span>
    </div>
  );
}
